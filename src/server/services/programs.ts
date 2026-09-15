import "server-only"

import { and, eq } from "drizzle-orm"

import { slugify } from "@/lib/utils"
import { type Transaction, withUser } from "@/server/db"
import { programAffiliates, programs } from "@/server/db/schema"
import type { environmentEnum } from "@/server/db/schema/enums"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"
import { assertCanCreate, assertLiveMode, assertWithinLimit, getWorkspaceEntitlements } from "./entitlements"

export type ProgramEnvironment = (typeof environmentEnum.enumValues)[number]

export interface ProgramInput {
  name: string
  description?: string | null
  /**
   * The product's site, where the tracker runs and the affiliates' default
   * link points. `undefined` leaves the stored value alone; `null` clears it.
   */
  websiteUrl?: string | null
  status: "draft" | "active" | "paused" | "archived"
  /**
   * Chosen at creation and never changed (docs/PLANS.md §2). Required to
   * create; on update it may be omitted, and anything but the stored value is
   * refused.
   */
  environment?: ProgramEnvironment
  commissionType: "percentage" | "fixed"
  /** Basis points for percentage, minor units for fixed. */
  commissionValue: number
  commissionDurationMonths: number | null
  attributionModel: "first_click" | "last_click"
  attributionWindowDays: number
  commissionHoldDays: number
  currency: string
}

function assertRule(input: ProgramInput): void {
  if (input.commissionType === "percentage" && input.commissionValue > 10_000) {
    throw new ValidationError("A percentage commission cannot exceed 100%.", {
      commissionValue: ["Must be 100% or less."],
    }, "percentageOver100")
  }
  if (input.commissionValue <= 0) {
    throw new ValidationError("Commission must be greater than zero.", {
      commissionValue: ["Must be greater than zero."],
    }, "commissionPositive")
  }
}

/**
 * The plan checks for one more program of `environment` that counts toward the
 * limits (not archived): live needs live mode, then a free slot. Takes the
 * per-workspace lock, so call it in the write's transaction, right before it.
 */
async function assertProgramSlot(tx: Transaction, workspaceId: string, environment: ProgramEnvironment) {
  const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
  if (environment === "live") {
    assertLiveMode(entitlements)
    await assertWithinLimit(tx, workspaceId, entitlements, "livePrograms")
  } else {
    await assertWithinLimit(tx, workspaceId, entitlements, "testPrograms")
  }
}

export async function createProgram(
  userId: string,
  workspaceId: string,
  input: ProgramInput & { environment: ProgramEnvironment },
): Promise<{ id: string; slug: string }> {
  assertRule(input)

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const slug = slugify(input.name)
    if (!slug) throw new ValidationError("Program name must contain letters or numbers.", {}, "programNameInvalid")

    const [existing] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.workspaceId, workspaceId), eq(programs.slug, slug)))
      .limit(1)

    if (existing) throw new ConflictError("A program with that name already exists.", "programNameTaken")

    // Inside the transaction and right before the write, so the count it reads
    // is the one the insert lands on. An archived program takes no slot, but
    // a live one still needs live mode.
    if (input.status === "archived") {
      const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
      assertCanCreate(entitlements)
      if (input.environment === "live") assertLiveMode(entitlements)
    } else {
      await assertProgramSlot(tx, workspaceId, input.environment)
    }

    const [row] = await tx
      .insert(programs)
      .values({
        workspaceId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
        status: input.status,
        environment: input.environment,
        commissionType: input.commissionType,
        commissionValue: input.commissionValue,
        commissionDurationMonths: input.commissionDurationMonths,
        attributionModel: input.attributionModel,
        attributionWindowDays: input.attributionWindowDays,
        commissionHoldDays: input.commissionHoldDays,
        currency: input.currency.toUpperCase(),
      })
      .returning({ id: programs.id, slug: programs.slug })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program",
      entityId: row!.id,
      action: "program.created",
      metadata: {
        environment: input.environment,
        commissionType: input.commissionType,
        commissionValue: input.commissionValue,
        attributionModel: input.attributionModel,
      },
    })

    return row!
  })
}

export async function updateProgram(
  userId: string,
  workspaceId: string,
  programId: string,
  input: ProgramInput,
): Promise<void> {
  assertRule(input)

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [existing] = await tx
      .select({
        id: programs.id,
        status: programs.status,
        environment: programs.environment,
        currency: programs.currency,
      })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.workspaceId, workspaceId)))
      .limit(1)
      // Serialises two saves of the same program (a restore racing a restore).
      .for("update")

    if (!existing) throw new NotFoundError("Program not found.", "programNotFound")

    // Test data never becomes live data: going live is a new live program.
    if (input.environment !== undefined && input.environment !== existing.environment) {
      throw new ValidationError(
        "A program's environment cannot change.",
        { environment: ["Immutable."] },
        "programEnvironmentImmutable",
      )
    }

    const currency = input.currency.toUpperCase()
    if (currency !== existing.currency.trim()) {
      // A fixed custom rate is an amount in the program's currency; changing
      // the currency would silently re-denominate it. The founder removes those
      // rates first (percentage rates are currency-free and stay).
      const [fixedRate] = await tx
        .select({ id: programAffiliates.id })
        .from(programAffiliates)
        .where(and(eq(programAffiliates.programId, programId), eq(programAffiliates.customCommissionType, "fixed")))
        .limit(1)
      if (fixedRate) {
        throw new ValidationError(
          "Remove the fixed custom rates before changing the program's currency.",
          { currency: ["Fixed custom rates exist."] },
          "customRatesBlockCurrencyChange",
        )
      }
    }

    // Restoring takes a slot again, so it is checked like a creation.
    if (existing.status === "archived" && input.status !== "archived") {
      await assertProgramSlot(tx, workspaceId, existing.environment)
    }

    await tx
      .update(programs)
      .set({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl?.trim() || null }),
        status: input.status,
        commissionType: input.commissionType,
        commissionValue: input.commissionValue,
        commissionDurationMonths: input.commissionDurationMonths,
        attributionModel: input.attributionModel,
        attributionWindowDays: input.attributionWindowDays,
        commissionHoldDays: input.commissionHoldDays,
        currency,
      })
      .where(eq(programs.id, programId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program",
      entityId: programId,
      action: "program.updated",
      metadata: { status: input.status, previousStatus: existing.status },
    })
  })
}
