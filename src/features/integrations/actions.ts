"use server"

import { actionError, successMessage } from "@/i18n/errors"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import { STRIPE_WEBHOOK_SECRET_PREFIX } from "@/lib/billing/stripe/events"
import {
  disconnectIntegration,
  saveStripeWebhookSecret,
  startStripeIntegration,
} from "@/server/services/integrations"
import { rotateApiKey } from "@/server/services/api-keys"
import { disconnectBillingConnection } from "@/server/services/billing-connections"
import { getWorkspaceForUser } from "@/server/services/workspaces"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"

export interface IntegrationFormState {
  error?: string
  success?: string
  /** The Stripe connection step 1 created or updated, so the UI can open it. */
  integrationId?: string
  /** Returned once, straight after rotation. Never persisted in plaintext. */
  revealedKey?: string
}

const startSchema = z.object({
  workspaceSlug: z.string().min(1),
  /** Which Stripe connection; absent = add this account (or the workspace's first). */
  integrationId: z.uuid().optional(),
  displayName: z.string().trim().max(60).optional(),
  providerAccountId: z
    .string()
    .trim()
    .regex(/^acct_[A-Za-z0-9]{8,}$/, "stripeAccountInvalid"),
})

/**
 * Step 1 of the Stripe setup: the account id. Creates the integration so its
 * own webhook URL can be shown. We store the account id only — never a secret
 * key.
 */
export async function startStripeAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = startSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId") || undefined,
    displayName: formData.get("displayName") || undefined,
    providerAccountId: formData.get("providerAccountId"),
  })

  if (!parsed.success) {
    const accountInvalid = Boolean(z.flattenError(parsed.error).fieldErrors.providerAccountId)
    return { error: await actionError(null, accountInvalid ? "stripeAccountInvalid" : "invalidRequest") }
  }

  let integrationId: string
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    integrationId = await startStripeIntegration(user.id, workspace.id, parsed.data.providerAccountId, {
      integrationId: parsed.data.integrationId ?? null,
      displayName: parsed.data.displayName ?? null,
    })
  } catch (error) {
    return { error: await actionError(error, "stripeNotConnected") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("stripeAccountSaved"), integrationId }
}

const secretSchema = z.object({
  workspaceSlug: z.string().min(1),
  integrationId: z.uuid().optional(),
  /** Which Stripe endpoint the secret belongs to: the test-mode one or the live one. */
  environment: z.enum(["test", "live"]),
  // Stripe endpoint signing secrets are `whsec_` plus an opaque token.
  webhookSecret: z
    .string()
    .trim()
    .startsWith(STRIPE_WEBHOOK_SECRET_PREFIX, "stripeSecretInvalid")
    .regex(/^whsec_[A-Za-z0-9+/=_-]{16,}$/, "stripeSecretInvalid"),
})

/**
 * Step 3: one endpoint's signing secret, test or live, each saved and replaced
 * on its own. Stored encrypted and never returned — not in this result, not on
 * the page.
 */
export async function saveStripeSecretAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = secretSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId") || undefined,
    environment: formData.get("environment"),
    webhookSecret: formData.get("webhookSecret"),
  })

  if (!parsed.success) {
    const secretInvalid = Boolean(z.flattenError(parsed.error).fieldErrors.webhookSecret)
    return { error: await actionError(null, secretInvalid ? "stripeSecretInvalid" : "invalidRequest") }
  }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await saveStripeWebhookSecret(
      user.id,
      workspace.id,
      parsed.data.environment,
      parsed.data.webhookSecret,
      parsed.data.integrationId ?? null,
    )
  } catch (error) {
    return { error: await actionError(error, "stripeSecretNotSaved") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("stripeSecretSaved") }
}

const disconnectSchema = z.object({ workspaceSlug: z.string().min(1), integrationId: z.uuid().optional() })

export async function disconnectStripeAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = disconnectSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId") || undefined,
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }
  const { workspaceSlug, integrationId } = parsed.data

  try {
    const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
    if (integrationId) await disconnectBillingConnection(user.id, workspace.id, integrationId)
    else await disconnectIntegration(user.id, workspace.id, "stripe")
  } catch (error) {
    return { error: await actionError(error, "stripeNotDisconnected") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("stripeDisconnected") }
}

const rotateSchema = z.object({
  workspaceSlug: z.string().min(1),
  type: z.enum(["publishable", "secret"]),
  environment: z.enum(["test", "live"]),
})

export async function rotateKeyAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = rotateSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    type: formData.get("type"),
    environment: formData.get("environment"),
  })

  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    // A live key needs live mode; the service refuses it with LIVE_MODE_REQUIRED otherwise.
    const key = await rotateApiKey(user.id, workspace.id, parsed.data.type, parsed.data.environment)

    revalidatePath(DASHBOARD_LAYOUT, "layout")
    return {
      success: await successMessage("keyRotated"),
      revealedKey: key.plaintext,
    }
  } catch (error) {
    return { error: await actionError(error, "keyNotRotated") }
  }
}
