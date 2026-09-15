import "server-only"

import { and, eq, sql } from "drizzle-orm"

import type { Locale } from "@/i18n/routing"
import { logger } from "@/lib/logger"
import { slugify } from "@/lib/utils"
import { type Transaction, withUser } from "@/server/db"
import { affiliates, programAffiliates, programs, referralLinks } from "@/server/db/schema"
import { canTransitionParticipation, type ParticipationTarget } from "@/server/domain/participation"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import {
  findOwnParticipation,
  findParticipationInWorkspace,
  isAffiliateCountedTowardPlan,
  lockReferralCodes,
  referralCodeTaken,
} from "@/server/repositories/affiliates"
import { findWorkspaceName } from "@/server/repositories/workspaces"

import { recordAudit } from "./audit"
import { assertCanCreate, assertFeature, assertWithinLimit, getWorkspaceEntitlements } from "./entitlements"
import { inviteLinksFor, sendInviteEmail, type InviteDelivery } from "./invite-mail"

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

export interface InviteAffiliateResult {
  affiliateId: string
  participationId: string
  code: string
  invite: InviteDelivery
}

/**
 * Creates (or reuses) the affiliate record and enrols them in a program, then
 * e-mails an invitation once that is committed.
 *
 * The affiliate does not need an account yet: the row is claimed by e-mail
 * when an account is created for that address, by the `handle_new_user`
 * trigger. An affiliate record already tied to an account needs no e-mail —
 * the new program appears in their portal.
 *
 * Known gap: an address that already has an account but whose affiliate row
 * is not yet linked is never claimed, because the trigger only runs when an
 * auth user is created. The result reports `accountExists` for that case.
 */
export async function inviteAffiliate(
  userId: string,
  workspaceId: string,
  input: InviteAffiliateInput,
  locale: Locale,
): Promise<InviteAffiliateResult> {
  const created = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [program] = await tx
      .select({ id: programs.id, status: programs.status })
      .from(programs)
      .where(and(eq(programs.id, input.programId), eq(programs.workspaceId, workspaceId)))
      .limit(1)

    if (!program) throw new NotFoundError("Program not found.", "programNotFound")
    // A draft program is being prepared and may enrol its first affiliates; an
    // archived one is closed.
    if (program.status === "archived") {
      throw new ConflictError("An archived program does not take new affiliates.", "programArchived")
    }

    if (
      (input.customCommissionType === null) !== (input.customCommissionValue === null) &&
      (input.customCommissionType !== undefined || input.customCommissionValue !== undefined)
    ) {
      throw new ValidationError("A custom rate needs both a type and a value.", {}, "customRateIncomplete")
    }

    const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
    // Past due beyond grace: no enrolment at all, even of an affiliate who
    // already counts (and so skips the limit check below).
    assertCanCreate(entitlements)
    if (input.customCommissionType != null) assertFeature(entitlements, "customAffiliateRates")

    const email = input.email.trim().toLowerCase()

    const [existing] = await tx
      .select({ id: affiliates.id, userId: affiliates.userId })
      .from(affiliates)
      .where(
        and(eq(affiliates.workspaceId, workspaceId), sql`lower(${affiliates.email}) = ${email}`),
      )
      .limit(1)

    // The new participation is pending or approved, so the affiliate counts
    // toward the plan afterwards. Only one who does not count yet takes a slot:
    // a new record, or an existing one whose every participation was rejected or
    // suspended. Enrolling a counted affiliate in another program is free.
    if (!existing || !(await isAffiliateCountedTowardPlan(tx, workspaceId, existing.id))) {
      await assertWithinLimit(tx, workspaceId, entitlements, "affiliates")
    }

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

    const code = await uniqueCode(tx, workspaceId, input.code || input.name)

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

    return {
      affiliateId,
      participationId: participation!.id,
      code,
      email,
      linked: Boolean(existing?.userId),
      workspaceName: (await findWorkspaceName(tx, workspaceId)) ?? "",
    }
  })

  const { email, linked, workspaceName, ...ids } = created

  const invite: InviteDelivery = linked
    ? { ...inviteLinksFor(email, locale), emailSent: false, skipped: "alreadyLinked" }
    : await sendInviteEmail({
        email,
        locale,
        audience: "affiliate",
        workspaceName,
        fullName: input.name.trim(),
      })

  return { ...ids, invite }
}

/**
 * Sends the invitation e-mail again, for an affiliate who has not found it.
 * Supabase re-sends to an address whose account was never confirmed and
 * refuses a confirmed one (`accountExists`), so this is safe to offer on any
 * affiliate row.
 */
export async function resendAffiliateInvite(
  userId: string,
  workspaceId: string,
  affiliateId: string,
  locale: Locale,
): Promise<InviteDelivery & { email: string; name: string }> {
  const affiliate = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [row] = await tx
      .select({ email: affiliates.email, name: affiliates.name })
      .from(affiliates)
      .where(and(eq(affiliates.id, affiliateId), eq(affiliates.workspaceId, workspaceId)))
      .limit(1)

    if (!row) throw new NotFoundError("Affiliate not found.", "affiliateNotFound")
    return { ...row, workspaceName: (await findWorkspaceName(tx, workspaceId)) ?? "" }
  })

  const delivery = await sendInviteEmail({
    email: affiliate.email,
    locale,
    audience: "affiliate",
    workspaceName: affiliate.workspaceName,
    fullName: affiliate.name,
  })
  return { ...delivery, email: affiliate.email, name: affiliate.name }
}

/**
 * A referral code free in the whole workspace, not only in the program: the
 * tracker resolves `ref` across every program of the workspace, so a code
 * shared by two programs would be ambiguous. Held under a per-workspace lock
 * until the insert commits.
 */
async function uniqueCode(tx: Transaction, workspaceId: string, desired: string): Promise<string> {
  const base = slugify(desired) || "partner"
  await lockReferralCodes(tx, workspaceId)

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    if (!(await referralCodeTaken(tx, workspaceId, candidate))) return candidate
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

    if (status === "approved") {
      // Approving makes the affiliate count toward the plan again if nothing
      // else did (rejected, suspended). One who already counts (a pending
      // application) adds nothing, but is still not approved while the
      // workspace is over its limit — after a downgrade, say (docs/PLANS.md §6).
      const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
      const counted = await isAffiliateCountedTowardPlan(tx, workspaceId, participation.affiliateId)
      await assertWithinLimit(tx, workspaceId, entitlements, "affiliates", counted ? 0 : 1)
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
    // Clearing stays allowed on any plan, so a downgraded workspace can undo
    // the rates it no longer pays for.
    if (rate) assertFeature(await getWorkspaceEntitlements(tx, workspaceId), "customAffiliateRates")

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

/**
 * The signed-in affiliate names a link on one of their own participations.
 * Being an admin of the workspace does not make someone else's participation
 * theirs. A suspended or rejected participation earns nothing, so it gets no
 * new links.
 */
export async function createReferralLink(
  userId: string,
  participationId: string,
  input: { name: string; destinationUrl: string; campaign?: string | null },
): Promise<{ id: string; code: string }> {
  return withUser(userId, async (tx) => {
    const participation = await findOwnParticipation(tx, userId, participationId)
    if (!participation) throw new NotFoundError("Affiliate participation not found.", "participationNotFound")
    if (participation.status === "suspended" || participation.status === "rejected") {
      throw new ConflictError("This participation cannot create links.", "participationInactive")
    }

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

    await recordLinkCreated(tx, {
      workspaceId: participation.workspaceId,
      actorUserId: userId,
      linkId: row.id,
      participationId,
    })
    return row
  })
}

/**
 * `link.created`, in a savepoint: an affiliate is not a workspace member and
 * the `audit_logs` insert policy admits owners and admins only, so the row can
 * be refused. A refused audit row must not undo the link it describes; it is
 * logged instead.
 */
async function recordLinkCreated(
  tx: Transaction,
  params: { workspaceId: string; actorUserId: string; linkId: string; participationId: string },
): Promise<void> {
  try {
    await tx.transaction((savepoint) =>
      recordAudit(savepoint, {
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        entityType: "referral_link",
        entityId: params.linkId,
        action: "link.created",
        metadata: { participationId: params.participationId },
      }),
    )
  } catch (error) {
    logger.warn("link.created audit not recorded", {
      workspaceId: params.workspaceId,
      error: error instanceof Error ? error.message : "unknown",
    })
  }
}
