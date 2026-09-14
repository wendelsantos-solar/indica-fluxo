import { ArrowRight, Check } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * The product is the hero — DESIGN.md §1. No illustrations, no gradient blobs:
 * a real dashboard mock built from the same tokens as the app itself.
 */
export default function MarketingHomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 text-meta text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            Referral infrastructure for SaaS
          </p>

          <h1 className="text-balance text-heading-sm font-medium sm:text-heading-lg">
            Turn referrals into a growth channel.
          </h1>

          <p className="mt-5 max-w-2xl text-pretty text-body leading-relaxed text-muted-foreground sm:text-body-md">
            Track every click, conversion and recurring commission without building affiliate
            infrastructure yourself. Connect billing, choose a commission, install one snippet —
            then invite affiliates and watch the ledger fill in.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/signup">
                Start free
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/docs">View the docs</Link>
            </Button>
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-caption text-muted-foreground">
            {["No payment processing", "Your Stripe stays yours", "Live in under an hour"].map(
              (item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                  {item}
                </li>
              ),
            )}
          </ul>
        </div>

        <DashboardPreview />
      </section>

      <section className="border-y border-border bg-surface-1">
        <div className="mx-auto grid w-full max-w-[1200px] gap-px bg-border px-0 sm:grid-cols-3">
          {[
            {
              title: "Attribution that holds up",
              body: "First-click or last-click, a configurable window, and a deterministic resolver that is unit-tested against every edge case — including the one where two affiliates claim the same visitor.",
            },
            {
              title: "A ledger, not a counter",
              body: "Every commission records the rule that produced it. Refunds create a reversal instead of deleting history, so your numbers still reconcile six months later.",
            },
            {
              title: "You keep the money rails",
              body: "Indica never touches a payment. It tells you exactly what you owe and to whom; you pay through Wise, Pix, PayPal or a bank transfer and mark the batch as paid.",
            },
          ].map((feature) => (
            <div key={feature.title} className="bg-surface-1 px-6 py-8">
              <h2 className="mb-2 text-body-sm font-medium tracking-tight">{feature.title}</h2>
              <p className="text-caption leading-relaxed text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="mb-2 text-heading-sm font-medium">
          Four steps, then it runs itself.
        </h2>
        <p className="mb-10 max-w-2xl text-body-sm leading-relaxed text-muted-foreground">
          Most founders are live the same afternoon. Nothing here requires a migration or a
          contract.
        </p>

        <ol className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: "01", title: "Connect billing", body: "Point your Stripe webhook at Indica. We read payment events; we never hold your keys." },
            { step: "02", title: "Choose a commission", body: "30% for 12 months, a flat fee, or a custom rate for your best partner." },
            { step: "03", title: "Install tracking", body: "One script tag sets a first-party cookie and reports the referral code." },
            { step: "04", title: "Invite affiliates", body: "They get a link and a portal. You get a ledger and a payout list." },
          ].map((item) => (
            <li key={item.step} className="bg-surface-1 px-6 py-7">
              <span className="font-mono text-meta text-primary">{item.step}</span>
              <h3 className="mb-1.5 mt-3 text-body-sm font-medium tracking-tight">{item.title}</h3>
              <p className="text-caption leading-relaxed text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-6 px-4 py-16 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-heading-sm font-medium">
              The simplest way to put a referral program live.
            </h2>
            <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
              Connect billing, choose a commission, install tracking, invite affiliates. Done.
            </p>
          </div>
          <Button asChild variant="primary" size="lg">
            <Link href="/signup">
              Start free
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}

/** A static, token-built mock of the real overview screen. */
function DashboardPreview() {
  const bars = [32, 41, 38, 55, 48, 62, 58, 71, 66, 84, 78, 96]

  return (
    <div className="mt-14 overflow-hidden rounded-panel border border-border bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="ml-2 font-mono text-label text-muted-foreground">
          acme.indica.app/overview
        </span>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        {[
          { label: "Affiliate revenue", value: "$18,430.20", delta: "+23.4%" },
          { label: "Commissions", value: "$5,529.06", delta: "+19.1%" },
          { label: "Active affiliates", value: "34", delta: "+6" },
        ].map((metric) => (
          <div key={metric.label} className="bg-surface-1 px-5 py-4">
            <p className="text-label uppercase tracking-[0.02em] text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-1.5 text-subheading font-medium tabular-nums tracking-tight">
              {metric.value}
            </p>
            <p className="mt-1 text-meta text-success-foreground">{metric.delta}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-caption font-medium">Revenue over time</p>
          <div className="flex gap-3 text-label text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-chart-1" aria-hidden="true" />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-chart-2" aria-hidden="true" />
              Commission
            </span>
          </div>
        </div>
        <div className="flex h-28 items-end gap-1.5" aria-hidden="true">
          {bars.map((height, index) => (
            <span key={index} className="flex-1 rounded-t-[2px] bg-chart-1/70" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>

      <div className="border-t border-border">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 bg-surface-2 px-5 py-2 text-label uppercase tracking-[0.02em] text-muted-foreground">
          <span>Affiliate</span>
          <span className="text-right">Revenue</span>
          <span className="text-right">Commission</span>
        </div>
        {[
          ["Wendel", "$6,120.00", "$1,836.00"],
          ["Agency Labs", "$4,980.00", "$1,494.00"],
          ["João", "$3,410.20", "$1,023.06"],
        ].map(([name, revenue, commission]) => (
          <div
            key={name}
            className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 border-t border-border px-5 py-3 text-caption tabular-nums"
          >
            <span className="text-foreground">{name}</span>
            <span className="text-right text-muted-foreground">{revenue}</span>
            <span className="text-right text-foreground">{commission}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
