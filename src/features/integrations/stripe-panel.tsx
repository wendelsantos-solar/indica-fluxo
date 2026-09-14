"use client"

import { useTranslations } from "next-intl"
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

import {
  connectStripeAction,
  disconnectStripeAction,
  type IntegrationFormState,
} from "./actions"
import { CodeField } from "./code-field"

const INITIAL: IntegrationFormState = {}

/** Provider event names — identifiers, not copy, so they are not translated. */
const STRIPE_EVENTS = [
  "invoice.payment_succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]

export function StripePanel({
  workspaceSlug,
  status,
  providerAccountId,
  webhookUrl,
  readOnly = false,
}: {
  workspaceSlug: string
  status: "connected" | "disconnected" | "error" | null
  providerAccountId: string | null
  webhookUrl: string
  /** A `member`: status and account only — connecting and disconnecting are admin actions. */
  readOnly?: boolean
}) {
  const t = useTranslations("forms.stripe")
  const [connectState, connect, connecting] = useActionState(connectStripeAction, INITIAL)
  // Called from a confirmation dialog, which closes when the action settles;
  // the result then shows inline in whichever view the page re-renders into.
  const [disconnectState, setDisconnectState] = useState<IntegrationFormState>(INITIAL)

  const connected = status === "connected"
  // Only the most recent outcome is worth showing.
  const lastSuccess = connected ? connectState.success : disconnectState.success

  return (
    <section>
      <SectionHeader
        title={t("title")}
        count={status ? <StatusBadge status={status} /> : undefined}
        description={t("description")}
        className="mb-3"
      />

      {connected ? (
        <div className="space-y-4">
          {lastSuccess ? <InlineAlert tone="success">{lastSuccess}</InlineAlert> : null}

          <MetricGrid>
            <MetricCell className="min-w-0">
              <p className="text-caption text-muted-foreground">{t("account")}</p>
              <p className="mt-1 truncate font-mono text-meta text-foreground">{providerAccountId}</p>
            </MetricCell>
            <MetricCell className="col-span-2 min-w-0 max-sm:border-t max-sm:border-border-faint">
              <p className="mb-1 text-caption text-muted-foreground">{t("webhook")}</p>
              <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField>
            </MetricCell>
          </MetricGrid>

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
                  action={async (formData) =>
                    setDisconnectState(await disconnectStripeAction(INITIAL, formData))
                  }
                >
                  <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                </ConfirmDialog>
              </div>

              {disconnectState.error ? (
                <InlineAlert tone="danger">{disconnectState.error}</InlineAlert>
              ) : null}
            </>
          )}
        </div>
      ) : readOnly ? (
        <div className="space-y-4">
          {status === "error" ? (
            <InlineAlert tone="danger" title={t("errorTitle")}>
              {t("errorBody")}
            </InlineAlert>
          ) : null}
          <InlineAlert>{t("adminOnly")}</InlineAlert>
        </div>
      ) : (
        <div className="space-y-4">
          {status === "error" ? (
            <InlineAlert tone="danger" title={t("errorTitle")}>
              {t("errorBody")}
            </InlineAlert>
          ) : null}
          {lastSuccess ? <InlineAlert tone="success">{lastSuccess}</InlineAlert> : null}

          <Card>
            <form action={connect} noValidate>
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <div className="space-y-4 p-4">
                <Field
                  label={t("accountId")}
                  htmlFor="providerAccountId"
                  required
                  hint={t("accountIdHint")}
                  error={connectState.error}
                >
                  <Input
                    id="providerAccountId"
                    name="providerAccountId"
                    placeholder={t("accountIdPlaceholder")}
                    className="font-mono sm:max-w-80"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-describedby={connectState.error ? "providerAccountId-error" : "providerAccountId-hint"}
                    invalid={Boolean(connectState.error)}
                  />
                </Field>

                <div className="space-y-1.5">
                  <p className="text-meta font-medium text-muted-foreground">{t("thenAdd")}</p>
                  <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField>
                  <p className="text-meta text-faint-foreground">
                    {t("events", { events: STRIPE_EVENTS.join(", ") })}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
                <Button type="submit" variant="primary" loading={connecting}>
                  {t("connect")}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </section>
  )
}
