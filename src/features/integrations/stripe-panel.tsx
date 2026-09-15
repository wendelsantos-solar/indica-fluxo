"use client"

import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useState } from "react"

import { MetricCell, MetricGrid } from "@/components/data-display/metric"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { cn } from "@/lib/utils"

import {
  disconnectStripeAction,
  saveStripeSecretAction,
  startStripeAction,
  type IntegrationFormState,
} from "./actions"
import { CodeField } from "./code-field"
import { needsSetup, stripeBadgeStatus, type StripeConnectionState } from "./stripe-status"

const INITIAL: IntegrationFormState = {}

export interface StripePanelProps {
  workspaceSlug: string
  state: StripeConnectionState
  providerAccountId: string | null
  secretSaved: boolean
  /** This integration's own endpoint; `null` until step 1 has created the integration. */
  webhookUrl: string | null
  /** Pre-formatted on the server ("há 5 minutos") so server and client agree. */
  lastEvent: { when: string; type: string } | null
  lastRejectedWhen: string | null
  /** A `member`: status only — setup and disconnecting are admin actions. */
  readOnly?: boolean
}

const code = (chunks: React.ReactNode) => <code className="font-mono text-meta">{chunks}</code>
const strong = (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>

export function StripePanel(props: StripePanelProps) {
  const { state, readOnly = false } = props
  const t = useTranslations("forms.stripe")
  const badge = stripeBadgeStatus(state)
  // Called from a confirmation dialog, which closes when the action settles.
  // Held here because disconnecting swaps the summary for the setup steps, and
  // the outcome has to survive that swap.
  const [disconnectState, setDisconnectState] = useState<IntegrationFormState>(INITIAL)
  const disconnect = async (formData: FormData) =>
    setDisconnectState(await disconnectStripeAction(INITIAL, formData))

  return (
    <section>
      <SectionHeader
        title={t("title")}
        count={badge ? <StatusBadge status={badge} label={t(`badge.${state}`)} /> : undefined}
        description={t("description")}
        className="mb-3"
      />

      {disconnectState.success && needsSetup(state) ? (
        <InlineAlert tone="success" className="mb-3">
          {disconnectState.success}
        </InlineAlert>
      ) : null}

      {needsSetup(state) ? (
        readOnly ? (
          <InlineAlert>{state === "notStarted" ? t("adminOnly") : t("memberSetupPending")}</InlineAlert>
        ) : (
          <SetupWizard {...props} />
        )
      ) : (
        <ConnectedSummary {...props} onDisconnect={disconnect} disconnectError={disconnectState.error} />
      )}
    </section>
  )
}

/** What the evidence says, in one sentence: waiting, receiving, or why it failed. */
function HealthAlert({ state, lastEvent, lastRejectedWhen }: StripePanelProps) {
  const t = useTranslations("forms.stripe.health")

  switch (state) {
    case "awaitingFirstEvent":
      return <InlineAlert title={t("awaitingTitle")}>{t("awaitingBody")}</InlineAlert>
    case "receiving":
      return lastEvent ? (
        <InlineAlert tone="success" title={t("receivingTitle", { when: lastEvent.when })}>
          {t.rich("receivingBody", { type: lastEvent.type, code })}
        </InlineAlert>
      ) : null
    case "lastEventFailed":
      return lastEvent ? (
        <InlineAlert tone="danger" title={t("failedTitle")}>
          {t.rich("failedBody", { type: lastEvent.type, when: lastEvent.when, code })}
        </InlineAlert>
      ) : null
    case "signatureRejected":
      return (
        <InlineAlert tone="danger" title={t("rejectedTitle")}>
          {t("rejectedBody", { when: lastRejectedWhen ?? "" })}
        </InlineAlert>
      )
    case "error":
      return (
        <InlineAlert tone="danger" title={t("errorTitle")}>
          {t("errorBody")}
        </InlineAlert>
      )
    default:
      return null
  }
}

/** The event names to tick in Stripe — identifiers, not copy, so never translated. */
function EventList() {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {STRIPE_HANDLED_EVENTS.map((event) => (
        <li
          key={event.type}
          className="inline-flex h-5 items-center rounded-badge border border-border bg-fill-subtle px-1.5 font-mono text-meta text-foreground-secondary"
        >
          {event.type}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Setup: three numbered steps. Step 1 creates the integration, which is what
// gives step 2 a URL to show; step 3 stores the endpoint's signing secret.
// ---------------------------------------------------------------------------

function SetupWizard({ workspaceSlug, state, providerAccountId, webhookUrl }: StripePanelProps) {
  const t = useTranslations("forms.stripe")
  const [accountState, saveAccount, savingAccount] = useActionState(startStripeAction, INITIAL)
  const [secretState, saveSecret, savingSecret] = useActionState(saveStripeSecretAction, INITIAL)
  const [editingAccount, setEditingAccount] = useState(false)
  // The forms show their own outcome inline; no toasts.
  useActionResult(accountState, {
    onSuccess: () => setEditingAccount(false),
    toastOnSuccess: false,
    toastOnError: false,
  })

  const started = state !== "notStarted" && Boolean(webhookUrl)
  const showAccountForm = !started || editingAccount

  return (
    <Card>
      <ol aria-label={t("steps.label")}>
        <Step index={1} status={started ? "done" : "current"} title={t("steps.account.title")}>
          {showAccountForm ? (
            <form action={saveAccount} noValidate className="space-y-3">
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <Field
                label={t("accountId")}
                htmlFor="providerAccountId"
                required
                hint={t("accountIdHint")}
                error={accountState.error}
              >
                <Input
                  id="providerAccountId"
                  name="providerAccountId"
                  defaultValue={providerAccountId ?? undefined}
                  placeholder={t("accountIdPlaceholder")}
                  className="font-mono sm:max-w-80"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-describedby={accountState.error ? "providerAccountId-error" : "providerAccountId-hint"}
                  invalid={Boolean(accountState.error)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {/* Once step 3 is current, it owns the one primary action. */}
                <Button type="submit" variant={started ? "secondary" : "primary"} size="sm" loading={savingAccount}>
                  {started ? t("steps.account.save") : t("steps.account.submit")}
                </Button>
                {editingAccount ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingAccount(false)}>
                    {t("cancel")}
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-meta text-foreground">{providerAccountId}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setEditingAccount(true)}>
                {t("steps.account.edit")}
              </Button>
            </div>
          )}
          {accountState.success && started && !editingAccount ? (
            <InlineAlert tone="success" className="mt-3">
              {accountState.success}
            </InlineAlert>
          ) : null}
        </Step>

        <Step index={2} status={started ? "current" : "upcoming"} title={t("steps.webhook.title")}>
          {started && webhookUrl ? (
            <div className="space-y-3">
              <p className="max-w-prose text-meta text-muted-foreground">
                {t.rich("steps.webhook.description", { strong })}
              </p>
              <div className="space-y-1.5">
                <p className="text-meta font-medium text-muted-foreground">{t("webhook")}</p>
                <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField>
              </div>
              <div className="space-y-1.5">
                <p className="text-meta font-medium text-muted-foreground">{t("steps.webhook.events")}</p>
                <EventList />
              </div>
            </div>
          ) : (
            <p className="text-meta text-faint-foreground">{t("steps.locked")}</p>
          )}
        </Step>

        <Step index={3} status={started ? "current" : "upcoming"} title={t("steps.secret.title")}>
          {started ? (
            <SecretForm
              workspaceSlug={workspaceSlug}
              action={saveSecret}
              pending={savingSecret}
              error={secretState.error}
              description={t.rich("steps.secret.description", { strong })}
            />
          ) : (
            <p className="text-meta text-faint-foreground">{t("steps.locked")}</p>
          )}
        </Step>
      </ol>
    </Card>
  )
}

function Step({
  index,
  status,
  title,
  children,
}: {
  index: number
  status: "done" | "current" | "upcoming"
  title: string
  children: React.ReactNode
}) {
  const t = useTranslations("forms.stripe.steps")
  return (
    <li
      aria-current={status === "current" ? "step" : undefined}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-border px-4 py-4 last:border-0 sm:px-5"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 items-center justify-center rounded-full border font-mono text-meta",
          status === "done" && "border-border-strong text-foreground",
          status === "current" && "border-foreground-secondary text-foreground",
          status === "upcoming" && "border-border text-faint-foreground",
        )}
      >
        {status === "done" ? <Check className="size-3.5" /> : index}
      </span>
      <div className="min-w-0 space-y-2">
        <h3
          className={cn(
            "pt-0.5 text-caption font-medium",
            status === "upcoming" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <span className="sr-only">{t("status", { index, status })} </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  )
}

function SecretForm({
  workspaceSlug,
  action,
  pending,
  error,
  description,
  onCancel,
}: {
  workspaceSlug: string
  action: (formData: FormData) => void
  pending: boolean
  error?: string
  description?: React.ReactNode
  onCancel?: () => void
}) {
  const t = useTranslations("forms.stripe")
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {description ? <p className="max-w-prose text-meta text-muted-foreground">{description}</p> : null}
      <Field label={t("secret")} htmlFor="webhookSecret" required hint={t("secretHint")} error={error}>
        {/* A password field: the secret is never shown back, and not echoed on screen while typed. */}
        <Input
          id="webhookSecret"
          name="webhookSecret"
          type="password"
          placeholder={t("secretPlaceholder")}
          className="font-mono sm:max-w-80"
          autoComplete="off"
          spellCheck={false}
          required
          aria-describedby={error ? "webhookSecret-error" : "webhookSecret-hint"}
          invalid={Boolean(error)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          {t("saveSecret")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Configured: evidence first, then the facts, then the one destructive action.
// ---------------------------------------------------------------------------

function ConnectedSummary(
  props: StripePanelProps & {
    onDisconnect: (formData: FormData) => Promise<void>
    disconnectError?: string
  },
) {
  const { workspaceSlug, providerAccountId, secretSaved, webhookUrl, readOnly = false } = props
  const t = useTranslations("forms.stripe")
  const [secretState, saveSecret, savingSecret] = useActionState(saveStripeSecretAction, INITIAL)
  const [replacing, setReplacing] = useState(false)
  useActionResult(secretState, {
    onSuccess: () => setReplacing(false),
    toastOnSuccess: false,
    toastOnError: false,
  })

  return (
    <div className="space-y-4">
      {secretState.success && !replacing ? <InlineAlert tone="success">{secretState.success}</InlineAlert> : null}
      <HealthAlert {...props} />

      <MetricGrid>
        <MetricCell className="min-w-0">
          <p className="text-caption text-muted-foreground">{t("account")}</p>
          <p className="mt-1 truncate font-mono text-meta text-foreground">{providerAccountId ?? "—"}</p>
        </MetricCell>
        <MetricCell className="col-span-2 min-w-0 max-sm:border-t max-sm:border-border-faint">
          <p className="mb-1 text-caption text-muted-foreground">{t("webhook")}</p>
          {webhookUrl ? <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField> : null}
        </MetricCell>
      </MetricGrid>

      <div className="space-y-1.5">
        <p className="text-meta font-medium text-muted-foreground">{t("steps.webhook.events")}</p>
        <EventList />
      </div>

      {readOnly ? null : (
        <div className="space-y-3 border-t border-border-faint pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{t("secret")}</p>
              <p className="mt-1 flex items-center gap-1.5 text-caption text-foreground">
                {secretSaved ? (
                  <>
                    <Check className="size-3.5 text-success-foreground" aria-hidden="true" />
                    {t("secretSaved")}
                  </>
                ) : (
                  t("secretMissing")
                )}
              </p>
            </div>
            {replacing ? null : (
              <Button type="button" variant="secondary" size="sm" onClick={() => setReplacing(true)}>
                {secretSaved ? t("replaceSecret") : t("saveSecret")}
              </Button>
            )}
          </div>
          {replacing ? (
            <SecretForm
              workspaceSlug={workspaceSlug}
              action={saveSecret}
              pending={savingSecret}
              error={secretState.error}
              onCancel={() => setReplacing(false)}
            />
          ) : secretState.error ? (
            <InlineAlert tone="danger">{secretState.error}</InlineAlert>
          ) : null}
        </div>
      )}

      {readOnly ? null : (
        <>
          {/* The one destructive action, apart from everything else. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-faint pt-4">
            <p className="max-w-prose text-meta text-muted-foreground">{t("disconnectHint")}</p>
            <ConfirmDialog
              trigger={t("disconnect")}
              title={t("disconnectTitle")}
              description={t("disconnectBody")}
              confirmLabel={t("disconnectConfirm")}
              action={props.onDisconnect}
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            </ConfirmDialog>
          </div>

          {props.disconnectError ? <InlineAlert tone="danger">{props.disconnectError}</InlineAlert> : null}
        </>
      )}
    </div>
  )
}
