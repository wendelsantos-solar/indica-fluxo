"use client"

import { Eye, EyeOff } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useRouter } from "@/i18n/navigation"

import {
  connectProviderAction,
  disconnectConnectionAction,
  renameConnectionAction,
  saveWebhookSecretAction,
  type ConnectionFormState,
} from "./connection-actions"

const INITIAL: ConnectionFormState = {}

function SecretInput({ id, name, label, hint }: { id: string; name: string; label: string; hint?: string }) {
  const t = useTranslations("forms.billing.connect")
  const [reveal, setReveal] = useState(false)
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        <Input id={id} name={name} type={reveal ? "text" : "password"} required autoComplete="off" spellCheck={false} className="pr-10 font-mono" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => setReveal((value) => !value)}
          aria-label={reveal ? t("hide") : t("show")}
          aria-pressed={reveal}
        >
          {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </Field>
  )
}

/** Mercado Pago step 2: the signature secret from its panel. */
export function WebhookSecretForm({ workspaceSlug, integrationId }: { workspaceSlug: string; integrationId: string }) {
  const t = useTranslations("forms.billing.webhookSecret")
  const [state, action, pending] = useActionState(saveWebhookSecretAction, INITIAL)
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <SecretInput id="webhook-secret" name="webhookSecret" label={t("label")} hint={t("hint")} />
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {state.success ? <InlineAlert tone="success">{state.success}</InlineAlert> : null}
      <Button type="submit" variant="primary" size="sm" loading={pending}>
        {t("submit")}
      </Button>
    </form>
  )
}

/** Replace the API key of an existing connection (rotation, or recovering from "invalid"). */
export function ReconnectForm({
  workspaceSlug,
  integrationId,
  provider,
  providerName,
}: {
  workspaceSlug: string
  integrationId: string
  provider: "mercado_pago" | "abacatepay" | "asaas"
  providerName: string
}) {
  const t = useTranslations("forms.billing")
  const [state, action, pending] = useActionState(connectProviderAction, INITIAL)
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <input type="hidden" name="provider" value={provider} />
      <SecretInput id="reconnect-key" name="apiKey" label={t(`connect.keyLabel.${provider}`)} hint={t("reconnect.hint")} />
      <p className="text-meta text-muted-foreground">{t("connect.security")}</p>
      {state.error ? (
        <InlineAlert tone="danger" title={t("connect.failedTitle", { provider: providerName })}>
          {state.error}
        </InlineAlert>
      ) : null}
      {state.success ? <InlineAlert tone="success">{state.success}</InlineAlert> : null}
      <Button type="submit" size="sm" loading={pending}>
        {t("reconnect.submit")}
      </Button>
    </form>
  )
}

export function RenameForm({
  workspaceSlug,
  integrationId,
  current,
}: {
  workspaceSlug: string
  integrationId: string
  current: string | null
}) {
  const t = useTranslations("forms.billing.rename")
  const [state, action, pending] = useActionState(renameConnectionAction, INITIAL)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <Field label={t("label")} htmlFor="connection-rename" className="min-w-0 flex-1">
        <Input id="connection-rename" name="displayName" defaultValue={current ?? ""} maxLength={60} required />
      </Field>
      <Button type="submit" size="md" loading={pending}>
        {t("submit")}
      </Button>
      {state.error ? <InlineAlert tone="danger" className="w-full">{state.error}</InlineAlert> : null}
    </form>
  )
}

/**
 * Disconnect, with the consequence stated before (brief §43): new events stop,
 * the ledger stays. Goes back to the list once the backend confirmed.
 */
export function DisconnectConnection({
  workspaceSlug,
  integrationId,
  label,
}: {
  workspaceSlug: string
  integrationId: string
  label: string
}) {
  const t = useTranslations("forms.billing.disconnect")
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const disconnect = async (formData: FormData) => {
    const result = await disconnectConnectionAction(INITIAL, formData)
    if (result.error) {
      setError(result.error)
      return
    }
    router.push({ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: { tab: "payments" } })
  }
  return (
    <div className="space-y-2">
      <ConfirmDialog
        trigger={t("trigger")}
        triggerVariant="danger"
        triggerSize="sm"
        title={t("title", { name: label })}
        description={t("body")}
        confirmLabel={t("confirm")}
        action={disconnect}
      >
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="integrationId" value={integrationId} />
      </ConfirmDialog>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </div>
  )
}
