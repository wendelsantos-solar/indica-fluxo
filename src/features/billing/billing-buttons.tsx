"use client"

import { useActionState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button, type ButtonProps } from "@/components/ui/button"

import { openBillingPortalAction, startCheckoutAction, type BillingActionState } from "./actions"

const INITIAL: BillingActionState = {}

interface BillingButtonProps {
  workspaceSlug: string
  label: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
}

/**
 * Stripe Checkout for `plan`. On success the action redirects to Stripe, so
 * the button keeps its spinner until the page leaves; a refusal is shown
 * inline under it. Owners and admins only — render it for them alone.
 */
export function CheckoutButton({
  workspaceSlug,
  plan,
  label,
  variant = "secondary",
  size = "md",
  className,
}: BillingButtonProps & { plan: "launch" | "growth" }) {
  const [state, action, pending] = useActionState(startCheckoutAction, INITIAL)
  return (
    <form action={action} className={className}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" variant={variant} size={size} loading={pending} className="max-sm:w-full">
        {label}
      </Button>
      {state.error ? (
        <InlineAlert tone="danger" className="mt-3">
          {state.error}
        </InlineAlert>
      ) : null}
    </form>
  )
}

/**
 * The Stripe Billing Portal: card, invoices, cancellation — or, with `plan`,
 * straight to confirming a switch to that plan.
 */
export function BillingPortalButton({
  workspaceSlug,
  plan,
  label,
  variant = "secondary",
  size = "md",
  className,
}: BillingButtonProps & { plan?: "launch" | "growth" }) {
  const [state, action, pending] = useActionState(openBillingPortalAction, INITIAL)
  return (
    <form action={action} className={className}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {plan ? <input type="hidden" name="plan" value={plan} /> : null}
      <Button type="submit" variant={variant} size={size} loading={pending} className="max-sm:w-full">
        {label}
      </Button>
      {state.error ? (
        <InlineAlert tone="danger" className="mt-3">
          {state.error}
        </InlineAlert>
      ) : null}
    </form>
  )
}
