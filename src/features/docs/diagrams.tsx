import { ArrowDown } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The guide's one diagram shape: a chain that fans out into the payment
 * methods and comes back together (brief §26). Plain HTML and tokens — no
 * image — so it follows light/dark, wraps at 375px and reads the same to a
 * screen reader through `description`, while the drawing itself is hidden.
 */
export function FanDiagram({
  label,
  description,
  top,
  branchesLabel,
  branches,
  bottom,
}: {
  /** The figure's accessible name, also shown as its caption. */
  label: string
  /** The path in words, for screen readers. */
  description: string
  top: { key: string; label: string; emphasis?: boolean }[]
  /** Names the group of branches ("any connected payment method"). */
  branchesLabel: string
  branches: { key: string; label: string; badge?: string }[]
  bottom: { key: string; label: string; emphasis?: boolean }[]
}) {
  return (
    <figure className="overflow-hidden rounded-panel border border-border bg-surface-1">
      <figcaption className="flex h-10 items-center border-b border-border px-4 text-meta text-muted-foreground">{label}</figcaption>
      <p className="sr-only">{description}</p>
      <div aria-hidden="true" className="flex flex-col items-center px-4 py-6 sm:px-6">
        {top.map((node, index) => (
          <Stacked key={node.key} first={index === 0}>
            <Node emphasis={node.emphasis}>{node.label}</Node>
          </Stacked>
        ))}
        <Stem />
        {/* "Any of these": one hairline group the path enters and leaves,
            wrapping freely — the same drawing at 1440px and at 375px. */}
        <div className="flex w-full max-w-xl flex-col items-center gap-2 rounded-panel border border-dashed border-border-strong px-3 py-3">
          <span className="text-micro text-muted-foreground">{branchesLabel}</span>
          <ul className="flex flex-wrap justify-center gap-2">
            {branches.map((branch) => (
              <li key={branch.key}>
                <Node>
                  {branch.label}
                  {branch.badge ? (
                    <span className="rounded-badge border border-warning/40 px-1 text-micro text-warning-foreground">{branch.badge}</span>
                  ) : null}
                </Node>
              </li>
            ))}
          </ul>
        </div>
        {bottom.map((node) => (
          <Stacked key={node.key}>
            <Node emphasis={node.emphasis}>{node.label}</Node>
          </Stacked>
        ))}
      </div>
    </figure>
  )
}

function Stacked({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <>
      {first ? null : <Stem />}
      {children}
    </>
  )
}

function Stem() {
  return <span className="h-4 w-px shrink-0 bg-border-strong" />
}

function Node({ children, emphasis = false }: { children: React.ReactNode; emphasis?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-caption",
        emphasis ? "border-foreground/40 bg-surface-2 font-medium text-foreground" : "border-border bg-surface-2 text-foreground-secondary",
      )}
    >
      {children}
    </span>
  )
}

/**
 * A human path read top to bottom ("Referral → sign-up → …"): one step per
 * line with an arrow between, so a phone never wraps an arrow onto its own
 * line. An ordered list, so it reads as steps.
 */
export function PathList({ label, steps }: { label: string; steps: { key: string; label: React.ReactNode; note?: React.ReactNode }[] }) {
  return (
    <ol aria-label={label} className="max-w-reading rounded-panel border border-border bg-surface-1 px-4 py-3">
      {steps.map((step, index) => (
        <li key={step.key}>
          {index > 0 ? (
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center text-faint-foreground">
              <ArrowDown className="size-3.5" />
            </span>
          ) : null}
          <p className="flex flex-wrap items-baseline gap-x-2 text-caption">
            <span className="font-medium text-foreground">{step.label}</span>
            {step.note ? <span className="text-muted-foreground">{step.note}</span> : null}
          </p>
        </li>
      ))}
    </ol>
  )
}
