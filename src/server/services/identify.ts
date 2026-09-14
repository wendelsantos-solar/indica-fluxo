import "server-only"

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"

import { hashEmail } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { db } from "@/server/db"
import { attributions, customers, programs } from "@/server/db/schema"
import { ValidationError } from "@/server/policies/errors"

export interface IdentifyInput {
  workspaceId: string
  visitorId: string
  externalId: string
  providerCustomerId?: string | null
  provider?: "stripe" | "paddle" | "manual"
  email?: string | null
}

export interface IdentifyResult {
  customerId: string
  boundAttributions: number
}

/**
 * Binds an anonymous visitor to a known customer of the SaaS client.
 *
 * Authenticated by SECRET key only — a browser-supplied customer id would let
 * anyone reassign commissions, so this is strictly server-to-server
 * (ARCHITECTURE.md §3.2). The e-mail, if given, is hashed before storage and
 * the plaintext never touches a column or a log line.
 */
export async function identifyCustomer(input: IdentifyInput): Promise<IdentifyResult> {
  if (!input.externalId.trim()) {
    throw new ValidationError("externalId is required.", { externalId: ["Required."] }, "externalIdRequired")
  }

  const provider = input.provider ?? "stripe"

  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        workspaceId: input.workspaceId,
        externalId: input.externalId.trim(),
        provider,
        providerCustomerId: input.providerCustomerId?.trim() || null,
        emailHash: input.email ? hashEmail(input.email) : null,
      })
      .onConflictDoUpdate({
        target: [customers.workspaceId, customers.externalId],
        // `customers_workspace_external_key` is a PARTIAL unique index. Postgres
        // only infers a partial index as the ON CONFLICT arbiter when the
        // statement repeats its predicate, so omitting this raises 42P10.
        targetWhere: sql`external_id is not null`,
        set: {
          providerCustomerId: input.providerCustomerId?.trim() || null,
          emailHash: input.email ? hashEmail(input.email) : null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: customers.id })

    // Bind every open attribution this visitor holds in this workspace.
    const bound = await tx
      .update(attributions)
      .set({
        customerExternalId: input.externalId.trim(),
        providerCustomerId: input.providerCustomerId?.trim() || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attributions.visitorId, input.visitorId),
          or(
            isNull(attributions.customerExternalId),
            eq(attributions.customerExternalId, input.externalId.trim()),
          ),
          inArray(
            attributions.programId,
            tx
              .select({ id: programs.id })
              .from(programs)
              .where(eq(programs.workspaceId, input.workspaceId)),
          ),
        ),
      )
      .returning({ id: attributions.id })

    logger.info("customer identified", {
      workspaceId: input.workspaceId,
      boundAttributions: bound.length,
    })

    return { customerId: customer!.id, boundAttributions: bound.length }
  })
}
