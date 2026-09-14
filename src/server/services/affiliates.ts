import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { slugify } from "@/lib/utils"
import { withUser } from "@/server/db"
import { affiliates, programAffiliates, programs, referralLinks } from "@/server/db/schema"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

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

    if (!program) throw new NotFoundError("Program not found.")

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

    if (duplicate) throw new ConflictError("That affiliate is already in this program.")

    if (
      (input.customCommissionType === null) !== (input.customCommissionValue === null) &&
      (input.customCommissionType !== undefined || input.customCommissionValue !== undefined)
    ) {
      throw new ValidationError("A custom rate needs both a type and a value.")
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

export async function setParticipationStatus(
  userId: string,
  workspaceId: string,
  participationId: string,
  status: "approved" | "rejected" | "suspended",
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const updated = await tx
      .update(programAffiliates)
      .set({ status, approvedAt: status === "approved" ? new Date() : null })
      .where(eq(programAffiliates.id, participationId))
      .returning({ id: programAffiliates.id, affiliateId: programAffiliates.affiliateId })

    if (updated.length === 0) throw new NotFoundError("Affiliate participation not found.")

    if (status === "approved") {
      await tx
        .update(affiliates)
        .set({ status: "active" })
        .where(eq(affiliates.id, updated[0]!.affiliateId))
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program_affiliate",
      entityId: participationId,
      action: status === "approved" ? "affiliate.approved" : "affiliate.rejected",
      metadata: { status },
    })
  })
}

export async function setCustomRate(
  userId: string,
  workspaceId: string,
  participationId: string,
  rate: { type: "percentage" | "fixed"; value: number } | null,
): Promise<void> {
  if (rate && rate.type === "percentage" && rate.value > 10_000) {
    throw new ValidationError("A percentage commission cannot exceed 100%.")
  }

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

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
      metadata: rate ? { type: rate.type, value: rate.value } : { cleared: true },
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

    if (!row) throw new ConflictError("Could not create the link.")
    return row
  })
}
