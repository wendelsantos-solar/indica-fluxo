import "server-only"

import { and, eq } from "drizzle-orm"

import { slugify } from "@/lib/utils"
import { withUser } from "@/server/db"
import { programs } from "@/server/db/schema"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"
import { assertWithinPlan } from "./plans"

export interface ProgramInput {
  name: string
  description?: string | null
  /**
   * The product's site, where the tracker runs and the affiliates' default
   * link points. `undefined` leaves the stored value alone; `null` clears it.
   */
  websiteUrl?: string | null
  status: "draft" | "active" | "paused" | "archived"
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

export async function createProgram(
  userId: string,
  workspaceId: string,
  input: ProgramInput,
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
    // is the one the insert lands on.
    await assertWithinPlan(tx, workspaceId, "programs")

    const [row] = await tx
      .insert(programs)
      .values({
        workspaceId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
        status: input.status,
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
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.workspaceId, workspaceId)))
      .limit(1)

    if (!existing) throw new NotFoundError("Program not found.", "programNotFound")

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
        currency: input.currency.toUpperCase(),
      })
      .where(eq(programs.id, programId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "program",
      entityId: programId,
      action: "program.updated",
      metadata: { status: input.status },
    })
  })
}
