"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  connectStripeAction,
  disconnectStripeAction,
  type IntegrationFormState,
} from "./actions"

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
}: {
  workspaceSlug: string
  status: "connected" | "disconnected" | "error" | null
  providerAccountId: string | null
  webhookUrl: string
}) {
  const t = useTranslations("forms.stripe")
  const [connectState, connect, connecting] = useActionState(connectStripeAction, INITIAL)
  const [disconnectState, disconnect, disconnecting] = useActionState(
    disconnectStripeAction,
    INITIAL,
  )

  const connected = status === "connected"

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-caption font-medium text-foreground">
          Stripe
          {status ? <StatusBadge status={status} /> : null}
        </h2>
        <p className="mt-0.5 max-w-[68ch] text-caption text-muted-foreground">{t("description")}</p>
      </div>

      {connected ? (
        <>
          <dl className="grid gap-x-6 border-y border-border sm:grid-cols-2">
            <div className="min-w-0 py-3">
              <dt className="text-caption text-muted-foreground">{t("account")}</dt>
              <dd className="mt-0.5 truncate font-mono text-meta text-foreground">
                {providerAccountId}
              </dd>
            </div>
            <div className="min-w-0 py-3 max-sm:border-t max-sm:border-border-faint">
              <dt className="text-caption text-muted-foreground">{t("webhook")}</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-meta text-foreground-secondary">
                  {webhookUrl}
                </code>
                <CopyButton value={webhookUrl} size="sm" />
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <form action={disconnect}>
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <Button type="submit" variant="danger" size="sm" loading={disconnecting}>
                {t("disconnect")}
              </Button>
            </form>

            {disconnectState.error ? (
              <p role="alert" className="text-meta text-danger-foreground">
                {disconnectState.error}
              </p>
            ) : connectState.success ? (
              <p role="status" className="text-meta text-success-foreground">
                {connectState.success}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <Card>
          <form action={connect}>
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
                  required
                />
              </Field>

              <div className="space-y-1.5">
                <p className="text-meta font-medium text-muted-foreground">{t("thenAdd")}</p>
                <div className="flex items-center gap-2 rounded-control border border-border bg-fill-subtle py-1.5 pl-2.5 pr-1.5">
                  <code className="min-w-0 flex-1 break-all font-mono text-meta text-foreground">
                    {webhookUrl}
                  </code>
                  <CopyButton value={webhookUrl} size="sm" />
                </div>
                <p className="text-meta text-faint-foreground">
                  {t("events", { events: STRIPE_EVENTS.join(", ") })}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
              {connectState.success ? (
                <p role="status" className="mr-auto text-meta text-success-foreground">
                  {connectState.success}
                </p>
              ) : null}
              <Button type="submit" variant="primary" loading={connecting}>
                {t("connect")}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  )
}
