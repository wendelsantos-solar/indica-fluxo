import "server-only"

import { and, desc, eq, like } from "drizzle-orm"

import { db, withUser, type Transaction } from "@/server/db"
import { commissions, customers, programAffiliates, programs, transactions } from "@/server/db/schema"
import { NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { handleBillingEvent } from "./billing-events"
import { identifyCustomer } from "./identify"
import { recordClick } from "./tracking"

/**
 * Test-mode conversions without Stripe, for the Sandbox journey (docs/PLANS.md
 * §2): a synthetic visitor clicks the affiliate's code, is identified as a
 * synthetic customer, and pays — through the SAME services a real click, a real
 * identify call and a real Stripe event go through (`recordClick`,
 * `identifyCustomer`, `handleBillingEvent`). Nothing here computes a
 * commission; if the simulation earns one, the real pipeline would too.
 *
 * Only test programs, only owners and admins. Authorisation runs under RLS
 * (`withUser`); the pipeline then runs on the service connection, exactly like
 * the ingest paths it exercises (ARCHITECTURE.md §2), and only ever writes
 * `environment = 'test'` rows.
 *
 * Every call carries a `simulationId` (generated when the dialog opens): the
 * synthetic ids derive from it, so a double submit replays nothing.
 */

/** Every synthetic id starts with this, so simulated rows are recognisable in the test ledger. */
export const SIMULATION_PREFIX = "sim_"

export interface SimulationResult {
  /** The synthetic customer's external id — what a renewal or refund refers to. */
  customerExternalId: string
  commission: {
    id: string
    amountMinor: number
    currency: string
    status: string
    eligibleAt: Date
  } | null
  /** Why no commission was created, or what was recorded; for logs and tests, not for display. */
  detail: string
}

type Client = Pick<Transaction, "transaction">

export interface SimulateConversionInput {
  programId: string
  participationId: string
  amountMinor: number
  externalId?: string | null
  simulationId: string
}

export async function simulateTestConversion(
  userId: string,
  workspaceId: string,
  input: SimulateConversionInput,
): Promise<SimulationResult> {
  await authorize(userId, workspaceId)
  return runTestConversion(db, workspaceId, input)
}

export async function simulateTestRenewal(
  userId: string,
  workspaceId: string,
  input: { customerExternalId: string; amountMinor: number; simulationId: string },
): Promise<SimulationResult> {
  await authorize(userId, workspaceId)
  return runTestRenewal(db, workspaceId, input)
}

export async function simulateTestRefund(
  userId: string,
  workspaceId: string,
  input: { customerExternalId: string; amountMinor?: number | null; simulationId: string },
): Promise<SimulationResult> {
  await authorize(userId, workspaceId)
  return runTestRefund(db, workspaceId, input)
}

async function authorize(userId: string, workspaceId: string): Promise<void> {
  await withUser(userId, (tx) => requireMembership(tx, workspaceId, userId, "admin"))
}

function assertAmount(amountMinor: number | null | undefined): void {
  if (amountMinor === null || amountMinor === undefined) return
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ValidationError("amount must be a positive integer of minor units", {}, "sandboxAmountInvalid")
  }
}

/** A lowercase, dash-free token from the simulation id, for synthetic provider ids. */
function token(simulationId: string): string {
  const cleaned = simulationId.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (cleaned.length < 16 || cleaned.length > 40) {
    throw new ValidationError("invalid simulation id", {}, "invalidRequest")
  }
  return cleaned
}

/**
 * The pipeline behind `simulateTestConversion`, on an explicit client so the
 * database-backed tests can roll it back. Callers must have authorised the user.
 */
export async function runTestConversion(
  client: Client,
  workspaceId: string,
  input: SimulateConversionInput,
  now = new Date(),
): Promise<SimulationResult> {
  assertAmount(input.amountMinor)
  const id = token(input.simulationId)
  const paymentId = `${SIMULATION_PREFIX}pay_${id}`

  const target = await client.transaction(async (tx) => {
    const [program] = await tx
      .select({
        id: programs.id,
        environment: programs.environment,
        status: programs.status,
        currency: programs.currency,
        websiteUrl: programs.websiteUrl,
      })
      .from(programs)
      .where(and(eq(programs.id, input.programId), eq(programs.workspaceId, workspaceId)))
      .limit(1)
    if (!program) throw new NotFoundError("Program not found.", "programNotFound")
    if (program.environment !== "test") {
      throw new ValidationError("Conversions can only be simulated on test programs.", {}, "sandboxLiveProgram")
    }

    const [participation] = await tx
      .select({ id: programAffiliates.id, code: programAffiliates.code, status: programAffiliates.status })
      .from(programAffiliates)
      .where(and(eq(programAffiliates.id, input.participationId), eq(programAffiliates.programId, program.id)))
      .limit(1)
    if (!participation) throw new NotFoundError("Participation not found.", "participationNotFound")

    // A click on a paused program or by an unapproved affiliate is recorded but
    // never attributed — the simulation would earn nothing and say nothing.
    if (program.status !== "active") {
      throw new ValidationError("The program must be active to simulate a conversion.", {}, "sandboxProgramNotActive")
    }
    if (participation.status !== "approved") {
      throw new ValidationError("The affiliate must be approved to simulate a conversion.", {}, "sandboxAffiliateNotApproved")
    }

    const replay = await summaryOf(tx, workspaceId, paymentId)
    if (!replay && input.externalId?.trim()) {
      // A chosen id must be new: the simulation creates its own customer and
      // never attaches synthetic payments to an existing test customer.
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.workspaceId, workspaceId),
            eq(customers.environment, "test"),
            eq(customers.externalId, input.externalId.trim()),
          ),
        )
        .limit(1)
      if (existing) {
        throw new ValidationError("That customer id is already used by another customer.", {}, "sandboxCustomerTaken")
      }
    }

    return { program, participation, replay }
  })

  if (target.replay) return target.replay

  const { program, participation } = target
  const visitorId = `v_sim${id}`.slice(0, 50)
  const externalId = input.externalId?.trim() || `${SIMULATION_PREFIX}${id}`

  const landing = new URL(program.websiteUrl ?? "https://sandbox.refvia.invalid/")
  landing.searchParams.set("ref", participation.code)

  const click = await recordClick(
    {
      workspaceId,
      environment: "test",
      programId: program.id,
      code: participation.code,
      visitorId,
      landingUrl: landing.toString(),
      userAgent: null,
      occurredAt: now,
    },
    client,
  )
  if (!click.recorded) throw new Error("a test click is never refused for live mode")

  const identified = await identifyCustomer(
    {
      workspaceId,
      environment: "test",
      visitorId,
      externalId,
      provider: "manual",
      providerCustomerId: `${SIMULATION_PREFIX}cus_${id}`,
    },
    client,
  )

  const customer = await client.transaction(async (tx) => {
    const [row] = await tx
      .select({ provider: customers.provider, providerCustomerId: customers.providerCustomerId })
      .from(customers)
      .where(eq(customers.id, identified.customerId))
      .limit(1)
    return row
  })
  if (customer?.providerCustomerId !== `${SIMULATION_PREFIX}cus_${id}`) {
    throw new ValidationError("That customer id is already used by another customer.", {}, "sandboxCustomerTaken")
  }

  await handleBillingEvent(
    workspaceId,
    {
      type: "payment.succeeded",
      provider: customer.provider,
      providerEventId: `${SIMULATION_PREFIX}evt_${id}`,
      rawType: "sandbox.payment",
      occurredAt: now,
      providerAccountId: null,
      environment: "test",
      providerTransactionId: paymentId,
      providerReferences: [],
      providerCustomerId: customer.providerCustomerId,
      providerSubscriptionId: null,
      customerEmail: null,
      currency: program.currency,
      amountMinor: input.amountMinor,
    },
    now,
    client,
  )

  return (
    (await client.transaction((tx) => summaryOf(tx, workspaceId, paymentId))) ?? {
      customerExternalId: externalId,
      commission: null,
      detail: "payment not recorded",
    }
  )
}

/** A second payment by a simulated customer: a renewal, judged by the program's recurrence rules. */
export async function runTestRenewal(
  client: Client,
  workspaceId: string,
  input: { customerExternalId: string; amountMinor: number; simulationId: string },
  now = new Date(),
): Promise<SimulationResult> {
  assertAmount(input.amountMinor)
  const id = token(input.simulationId)
  const paymentId = `${SIMULATION_PREFIX}pay_${id}`

  const found = await client.transaction(async (tx) => ({
    customer: await simulatedCustomer(tx, workspaceId, input.customerExternalId),
    replay: await summaryOf(tx, workspaceId, paymentId),
  }))
  if (found.replay) return found.replay
  const { customer } = found

  await handleBillingEvent(
    workspaceId,
    {
      type: "payment.succeeded",
      provider: customer.provider,
      providerEventId: `${SIMULATION_PREFIX}evt_${id}`,
      rawType: "sandbox.payment",
      occurredAt: now,
      providerAccountId: null,
      environment: "test",
      providerTransactionId: paymentId,
      providerReferences: [],
      providerCustomerId: customer.providerCustomerId,
      providerSubscriptionId: null,
      customerEmail: null,
      currency: customer.currency,
      amountMinor: input.amountMinor,
    },
    now,
    client,
  )

  return (
    (await client.transaction((tx) => summaryOf(tx, workspaceId, paymentId))) ?? {
      customerExternalId: customer.externalId,
      commission: null,
      detail: "payment not recorded",
    }
  )
}

/** Refunds a simulated customer's latest payment — in full unless an amount is given. */
export async function runTestRefund(
  client: Client,
  workspaceId: string,
  input: { customerExternalId: string; amountMinor?: number | null; simulationId: string },
  now = new Date(),
): Promise<SimulationResult> {
  assertAmount(input.amountMinor)
  const id = token(input.simulationId)
  const refundId = `${SIMULATION_PREFIX}ref_${id}`

  const found = await client.transaction(async (tx) => {
    const customer = await simulatedCustomer(tx, workspaceId, input.customerExternalId)
    return { customer, replay: await summaryOf(tx, workspaceId, refundId) }
  })
  if (found.replay) return found.replay
  const { customer } = found

  await handleBillingEvent(
    workspaceId,
    {
      type: "payment.refunded",
      provider: customer.provider,
      providerEventId: `${SIMULATION_PREFIX}evt_${id}`,
      rawType: "sandbox.refund",
      occurredAt: now,
      providerAccountId: null,
      environment: "test",
      providerTransactionId: refundId,
      paymentReferences: [customer.lastPaymentId],
      providerCustomerId: customer.providerCustomerId,
      currency: customer.currency,
      amountMinor: input.amountMinor ?? customer.lastPaymentMinor,
      isChargeback: false,
    },
    now,
    client,
  )

  return (
    (await client.transaction((tx) => summaryOf(tx, workspaceId, refundId))) ?? {
      customerExternalId: customer.externalId,
      commission: null,
      detail: "refund not recorded",
    }
  )
}

/** A customer created by a simulation, with its latest simulated payment. */
async function simulatedCustomer(tx: Transaction, workspaceId: string, externalId: string) {
  const [row] = await tx
    .select({
      externalId: customers.externalId,
      provider: customers.provider,
      providerCustomerId: customers.providerCustomerId,
      lastPaymentId: transactions.providerTransactionId,
      lastPaymentMinor: transactions.grossAmountMinor,
      currency: transactions.currency,
    })
    .from(customers)
    .innerJoin(
      transactions,
      and(eq(transactions.customerId, customers.id), eq(transactions.type, "payment"), eq(transactions.environment, "test")),
    )
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, "test"),
        eq(customers.externalId, externalId.trim()),
        like(customers.providerCustomerId, `${SIMULATION_PREFIX}cus_%`),
        like(transactions.providerTransactionId, `${SIMULATION_PREFIX}pay_%`),
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
    .limit(1)

  if (!row?.externalId || !row.providerCustomerId) {
    throw new NotFoundError("No simulated customer with that id.", "sandboxCustomerNotFound")
  }
  return { ...row, externalId: row.externalId, providerCustomerId: row.providerCustomerId }
}

/** The commission (or reversal) a simulated transaction produced, or `null` if it was never recorded. */
async function summaryOf(tx: Transaction, workspaceId: string, providerTransactionId: string): Promise<SimulationResult | null> {
  const [row] = await tx
    .select({
      transactionId: transactions.id,
      externalId: customers.externalId,
    })
    .from(transactions)
    .innerJoin(customers, eq(customers.id, transactions.customerId))
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.environment, "test"),
        eq(transactions.providerTransactionId, providerTransactionId),
      ),
    )
    .limit(1)
  if (!row) return null

  const [commission] = await tx
    .select({
      id: commissions.id,
      amountMinor: commissions.commissionAmountMinor,
      currency: commissions.currency,
      status: commissions.status,
      eligibleAt: commissions.eligibleAt,
      reversalOf: commissions.reversalOfCommissionId,
    })
    .from(commissions)
    .where(eq(commissions.transactionId, row.transactionId))
    .limit(1)

  return {
    customerExternalId: row.externalId ?? "",
    commission: commission
      ? {
          id: commission.id,
          amountMinor: commission.amountMinor,
          currency: commission.currency,
          status: commission.status,
          eligibleAt: commission.eligibleAt,
        }
      : null,
    detail: commission ? (commission.reversalOf ? "reversal recorded" : "commission recorded") : "no commission",
  }
}
