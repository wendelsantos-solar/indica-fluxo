import { ArrowRight, Check } from "lucide-react"
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Pricing" }

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    cadence: "while you validate",
    description: "Everything you need to run one program and prove the channel works.",
    features: [
      "1 program",
      "Up to 10 affiliates",
      "Click tracking and attribution",
      "Commission ledger",
      "Manual payouts",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Growth",
    price: "$49",
    cadence: "per month",
    description: "For a program that is already producing revenue you care about.",
    features: [
      "Unlimited programs",
      "Unlimited affiliates",
      "Custom affiliate rates",
      "Payout batches and history",
      "Team members and audit log",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    name: "Scale",
    price: "$149",
    cadence: "per month",
    description: "Multiple products, a partnerships hire, and reporting people rely on.",
    features: [
      "Everything in Growth",
      "Multiple workspaces",
      "Priority support",
      "Extended data retention",
      "Onboarding help",
    ],
    cta: "Start free",
    featured: false,
  },
]

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
      <div className="max-w-2xl">
        <h1 className="text-heading-sm font-medium sm:text-heading">
          Priced like a tool, not a tax.
        </h1>
        <p className="mt-4 text-body-sm leading-relaxed text-muted-foreground">
          We do not take a percentage of your affiliate revenue, because we never touch the money.
          You pay for the infrastructure and keep the upside.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "flex flex-col rounded-panel border bg-surface-1 p-6",
              plan.featured ? "border-border-strong" : "border-border",
            )}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-body-sm font-medium">{plan.name}</h2>
              {plan.featured ? (
                <span className="rounded-badge bg-primary/15 px-2 py-0.5 text-label font-medium text-foreground">
                  Most popular
                </span>
              ) : null}
            </div>

            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="text-heading-sm font-medium tabular-nums tracking-tight">
                {plan.price}
              </span>
              <span className="text-caption text-muted-foreground">{plan.cadence}</span>
            </p>

            <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
              {plan.description}
            </p>

            <ul className="mt-6 flex-1 space-y-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-caption">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-foreground-secondary">{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              asChild
              variant={plan.featured ? "primary" : "secondary"}
              size="lg"
              className="mt-6 w-full"
            >
              <Link href="/signup">
                {plan.cta}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
