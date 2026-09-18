"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, successMessage } from "@/i18n/errors"
import { CONNECTOR_IDS } from "@/lib/billing/catalog"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"
import { requireUser } from "@/server/auth/session"
import {
  connectApiProvider,
  disconnectBillingConnection,
  renameBillingConnection,
  saveBillingSelection,
  saveConnectionWebhookSecret,
} from "@/server/services/billing-connections"
import { getWorkspaceForUser } from "@/server/services/workspaces"

/**
 * Route-handler-shaped server actions for billing connections: parse →
 * validate (Zod) → authorize (the service) → call → respond. No business logic
 * here (CLAUDE.md rule 5). No action ever returns a credential.
 */

export interface ConnectionFormState {
  error?: string
  success?: string
  /** The connection the action created or touched, so the UI can link to it. */
  integrationId?: string
  /** Mercado Pago: the token is valid, the panel step is next. */
  awaitingWebhook?: boolean
}

const workspaceSlug = z.string().min(1)

const connectSchema = z.object({
  workspaceSlug,
  provider: z.enum(["mercado_pago", "abacatepay", "asaas"]),
  apiKey: z.string().trim().min(10, "billing.invalid_credentials").max(500),
  webhookSecret: z.string().trim().max(500).optional(),
  displayName: z.string().trim().max(60).optional(),
  integrationId: z.uuid().optional(),
})

export async function connectProviderAction(
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const user = await requireUser()
  const parsed = connectSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    provider: formData.get("provider"),
    apiKey: formData.get("apiKey"),
    webhookSecret: formData.get("webhookSecret") || undefined,
    displayName: formData.get("displayName") || undefined,
    integrationId: formData.get("integrationId") || undefined,
  })
  if (!parsed.success) {
    const keyInvalid = Boolean(z.flattenError(parsed.error).fieldErrors.apiKey)
    return { error: await actionError(null, keyInvalid ? "billing.invalid_credentials" : "invalidRequest") }
  }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const result = await connectApiProvider(user.id, workspace.id, {
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey,
      webhookSecret: parsed.data.webhookSecret ?? null,
      displayName: parsed.data.displayName ?? null,
      integrationId: parsed.data.integrationId ?? null,
      notifyEmail: user.email,
    })
    revalidatePath(DASHBOARD_LAYOUT, "layout")
    const awaitingWebhook = parsed.data.provider === "mercado_pago" && !parsed.data.webhookSecret
    return {
      success: await successMessage(awaitingWebhook ? "billingTokenSaved" : "billingConnected"),
      integrationId: result.integrationId,
      awaitingWebhook,
    }
  } catch (error) {
    return { error: await actionError(error, "billing.provider_unavailable") }
  }
}

const secretSchema = z.object({
  workspaceSlug,
  integrationId: z.uuid(),
  webhookSecret: z.string().trim().min(8, "billing.invalid_credentials").max(500),
})

export async function saveWebhookSecretAction(
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const user = await requireUser()
  const parsed = secretSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId"),
    webhookSecret: formData.get("webhookSecret"),
  })
  if (!parsed.success) return { error: await actionError(null, "billing.invalid_credentials") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await saveConnectionWebhookSecret(user.id, workspace.id, parsed.data.integrationId, parsed.data.webhookSecret)
  } catch (error) {
    return { error: await actionError(error, "billing.invalid_credentials") }
  }
  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("billingWebhookSecretSaved"), integrationId: parsed.data.integrationId }
}

const connectionSchema = z.object({ workspaceSlug, integrationId: z.uuid() })

export async function disconnectConnectionAction(
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const user = await requireUser()
  const parsed = connectionSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const { webhookRemoved } = await disconnectBillingConnection(user.id, workspace.id, parsed.data.integrationId)
    revalidatePath(DASHBOARD_LAYOUT, "layout")
    return { success: await successMessage(webhookRemoved ? "billingDisconnectedWebhookRemoved" : "billingDisconnected") }
  } catch (error) {
    return { error: await actionError(error, "billingNotDisconnected") }
  }
}

const renameSchema = z.object({ workspaceSlug, integrationId: z.uuid(), displayName: z.string().trim().min(1).max(60) })

export async function renameConnectionAction(
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    integrationId: formData.get("integrationId"),
    displayName: formData.get("displayName"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await renameBillingConnection(user.id, workspace.id, parsed.data.integrationId, parsed.data.displayName)
  } catch (error) {
    return { error: await actionError(error, "invalidRequest") }
  }
  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("billingRenamed") }
}

const selectionSchema = z.object({ workspaceSlug, providers: z.array(z.enum([...CONNECTOR_IDS, "other"])).max(8) })

export async function saveProviderSelectionAction(
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const user = await requireUser()
  const parsed = selectionSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    providers: formData.getAll("providers"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await saveBillingSelection(user.id, workspace.id, parsed.data.providers)
  } catch (error) {
    return { error: await actionError(error, "invalidRequest") }
  }
  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("billingSelectionSaved") }
}
