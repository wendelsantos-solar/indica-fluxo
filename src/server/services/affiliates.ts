import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { slugify } from "@/lib/utils"
import { withUser } from "@/server/db"
import { affiliates, programAffiliates, programs, referralLinks } from "@/server/db/schema"
import { canTransitionParticipation, type ParticipationTarget } from "@/server/domain/participation"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import { findParticipationInWorkspace } from "@/server/repositories/affiliates"

import { recordAudit } from "./audit"

export interface InviteAffiliateInput {
  programId: string
  name: string
  email: string
  companyName?: string | null
  country?: string | null
  code?: string | null
  customCommissionType?: "percentage" | "fixed" | null
  customCommissionValue?: number | null
  autoApprove?: boolean
}

/**
 * Creates (or reuses) the affiliate record and enrols them in a program.
 * The affiliate does not need an account yet: the row is claimed by e-mail on
 * their first sign-in, by the `handle_new_user` trigger.
 */
export async function inviteAffiliate(
  userId: string,
  workspaceId: string,
  input: InviteAffiliateInput,
): Promise<{ affiliateId: string; participationId: string; code: string }> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, input.programId), eq(programs.workspaceId, workspaceId)))
      .limit(1)

    if (!program) throw new NotFoundError("Program not found.", "programNotFound")

    const email = input.email.trim().toLowerCase()

    const [existing] = await tx
      .select({ id: affiliates.id })
      .from(affiliates)
      .where(
        and(eq(affiliates.workspaceId, workspaceId), sql`lower(${affiliates.email}) = ${email}`),
      )
      .limit(1)

    const affiliateId =
      existing?.id ??
      (
        await tx
          .insert(affiliates)
          .values({
            workspaceId,
            email,
            name: input.name.trim(),
            companyName: input.companyName?.trim() || null,
            country: input.country?.toUpperCase() || null,
            status: "invited",
          })
          .returning({ id: affiliates.id })
      )[0]!.id

    const code = await uniqueCode(tx, input.programId, input.code || input.name)

    const [duplicate] = await tx
      .select({ id: programAffiliates.id })
      .from(programAffiliates)
      .where(
        and(
          eq(programAffiliates.programId, input.programId),
          eq(programAffiliates.affiliateId, affiliateId),
        ),
      )
      .limit(1)

    if (duplicate) throw new ConflictError("That affiliate is already in this program.", "affiliateAlreadyInProgram")

    if (
      (input.customCommissionType === null) !== (input.customCommissionValue === null) &&
      (input.customCommissionType !== undefined || input.customCommissionValue !== undefined)
    ) {
      throw new ValidationError("A custom rate needs both a type and a value.", {}, "customRateIncomplete")
    }

    const approve = input.autoApprove ?? true

    const [participation] = await tx
      .insert(programAffiliates)
      .values({
        programId: input.programId,
        affiliateId,
        code,
        status: approve ? "approved" : "pending",
        approvedAt: approve ? new Date() : null,
        customCommissionType: input.customCommissionType ?? null,
        customCommissionValue: input.customCommissionValue ?? null,
      })
      .returning({ id: programAffiliates.id })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "affiliate",
      entityId: affiliateId,
      action: "affiliate.created",
      metadata: { programId: input.programId, code, autoApproved: approve },
    })

    return { affiliateId, participationId: participation!.id, code }
  })
}

async function uniqueCode(
  tx: Parameters<Parameters<typeof withUser>[1]>[0],
  programId: string,
  desired: string,
): Promise<string> {
  const base = slugify(desired) || "partner"

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const [taken] = await tx
      .select({ id: programAffiliates.id })
      .from(programAffiliates)
      .where(
        and(eq(programAffiliates.programId, programId), eq(programAffiliates.code, candidate)),
      )
      .limit(1)
    if (!taken) return candidate
  }

  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Approve, reject or suspend one participation. The participation must belong
 * to a program of this workspace — an admin of two workspaces cannot reach
 * across from one to the other through an id — and the move must be one the
 * founder is offered (`server/domain/participation.ts`).
 */
export async function setParticipationStatus(
  userId: string,
  workspaceId: string,
  participationId: string,
  status: ParticipationTarget,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const participation = await findParticipationInWorkspace(tx, workspaceId, participationId)
    if (!participation) {
      throw new NotFoundError("Affiliate participation not found.", "participationNotFound")
    }

    if (!canTransitionParticipation(participation.status, status)) {
      throw new ConflictError(
        `A ${participation.status} participation cannot become ${status}.`,
        "participationTransitionInvalid",
      )
    }

    await tx
      .update(programAffiliates)
      .set({ status, approvedAt: status === "approved" ? new Date() : null })
      .where(eq(programAffiliates.id, participationId))

    if (status === "approved") {
      await tx
        .update(affiliates)
        .set({ status: "active" })
        .where(eq(affiliates.id, participation.affiliateId))
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program_affiliate",
      entityId: participationId,
      action:
        status === "approved"
          ? "affiliate.approved"
          : status === "suspended"
            ? "affiliate.suspended"
            : "affiliate.rejected",
      metadata: { status, previousStatus: participation.status },
    })
  })
}

export type CustomRate =
  | { type: "percentage"; value: number }
  /** Minor units of `currency`, which must be the program's currency. */
  | { type: "fixed"; value: number; currency: string }

/** Sets or clears (`null`) the affiliate override that beats the program rule. */
export async function setCustomRate(
  userId: string,
  workspaceId: string,
  participationId: string,
  rate: CustomRate | null,
): Promise<void> {
  if (rate) {
    if (!Number.isInteger(rate.value) || rate.value <= 0) {
      throw new ValidationError("A custom rate must be a positive integer.", {}, "customRateIncomplete")
    }
    if (rate.type === "percentage" && rate.value > 10_000) {
      throw new ValidationError("A percentage commission cannot exceed 100%.", {}, "percentageOver100")
    }
  }

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const participation = await findParticipationInWorkspace(tx, workspaceId, participationId)
    if (!participation) {
      throw new NotFoundError("Affiliate participation not found.", "participationNotFound")
    }

    // A fixed amount means nothing without its currency: an amount entered
    // against a program that has since changed currency must not be stored.
    if (rate?.type === "fixed" && rate.currency.toUpperCase() !== participation.programCurrency) {
      throw new ConflictError(
        `Fixed rate given in ${rate.currency}, program pays in ${participation.programCurrency}.`,
        "customRateCurrencyChanged",
      )
    }

    await tx
      .update(programAffiliates)
      .set({
        customCommissionType: rate?.type ?? null,
        customCommissionValue: rate?.value ?? null,
      })
      .where(eq(programAffiliates.id, participationId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program_affiliate",
      entityId: participationId,
      action: "affiliate.rate_changed",
      metadata: rate
        ? { type: rate.type, value: rate.value, currency: participation.programCurrency }
        : { cleared: true },
    })
  })
}

export async function createReferralLink(
  userId: string,
  participationId: string,
  input: { name: string; destinationUrl: string; campaign?: string | null },
): Promise<{ id: string; code: string }> {
  return withUser(userId, async (tx) => {
    // RLS restricts this insert to the owning affiliate or a workspace admin.
    const code = slugify(input.name) || `link-${Math.random().toString(36).slice(2, 6)}`

    const [row] = await tx
      .insert(referralLinks)
      .values({
        programAffiliateId: participationId,
        name: input.name.trim(),
        destinationUrl: input.destinationUrl.trim(),
        code,
        campaign: input.campaign?.trim() || null,
      })
      .returning({ id: referralLinks.id, code: referralLinks.code })

    if (!row) throw new ConflictError("Could not create the link.", "linkNotCreated")
    return row
  })
}
