"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  connectStripeAction,
  disconnectStripeAction,
  type IntegrationFormState,
} from "./actions"

const INITIAL: IntegrationFormState = {}

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
  const [connectState, connect, connecting] = useActionState(connectStripeAction, INITIAL)
  const [disconnectState, disconnect, disconnecting] = useActionState(
    disconnectStripeAction,
    INITIAL,
  )

  const connected = status === "connected"

  return (
    <Card>
      <CardHeader bordered>
        <div>
          <CardTitle className="flex items-center gap-2">
            Stripe
            {status ? <StatusBadge status={status} /> : null}
          </CardTitle>
          <CardDescription>
            Indica reads payment events to calculate commissions. It never moves money and never
            stores your Stripe secret key.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {connected ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-label uppercase tracking-[0.02em] text-muted-foreground">
                  Account
                </dt>
                <dd className="font-mono text-caption text-foreground">{providerAccountId}</dd>
              </div>
              <div>
                <dt className="text-label uppercase tracking-[0.02em] text-muted-foreground">
                  Webhook endpoint
                </dt>
                <dd className="break-all font-mono text-meta text-foreground-secondary">
                  {webhookUrl}
                </dd>
              </div>
            </dl>

            <form action={disconnect}>
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <Button type="submit" variant="danger" size="sm" loading={disconnecting}>
                Disconnect Stripe
              </Button>
            </form>

            {disconnectState.error ? (
              <p role="alert" className="text-meta text-danger-foreground">
                {disconnectState.error}
              </p>
            ) : null}
          </>
        ) : (
          <form action={connect} className="space-y-4">
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <Field
              label="Stripe account id"
              htmlFor="providerAccountId"
              required
              hint="Found in your Stripe dashboard under Settings → Account details."
              error={connectState.error}
            >
              <Input
                id="providerAccountId"
                name="providerAccountId"
                placeholder="acct_1A2b3C4d5E"
                className="font-mono sm:max-w-[320px]"
                required
              />
            </Field>

            <div className="rounded-control border border-border bg-surface-2 p-3">
              <p className="mb-1 text-meta font-medium text-foreground-secondary">
                Then add this webhook endpoint in Stripe:
              </p>
              <code className="block break-all font-mono text-meta text-foreground">
                {webhookUrl}
              </code>
              <p className="mt-2 text-meta text-muted-foreground">
                Events: invoice.payment_succeeded, charge.refunded, charge.dispute.created,
                customer.subscription.updated, customer.subscription.deleted.
              </p>
            </div>

            <Button type="submit" variant="primary" loading={connecting}>
              Connect Stripe
            </Button>
          </form>
        )}

        {connectState.success ? (
          <p role="status" className="text-meta text-success-foreground">
            {connectState.success}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
