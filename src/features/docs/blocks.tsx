import { ArrowRight, Check } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The guide's structural blocks. Each one answers a question a reader has
 * while implementing — "what do I do, in order", "where and with what",
 * "how do I know it worked", "what happens over time" — so a section can be
 * scanned instead of read. Server components, tokens only.
 */

/** Numbered steps: a short title, an optional body and room for a sample. */
export function Steps({
  items,
  label,
}: {
  items: { key: string; title: React.ReactNode; body?: React.ReactNode; children?: React.ReactNode }[]
  label?: string
}) {
  return (
    <ol aria-label={label} className="space-y-6">
      {items.map((item, index) => (
        <li key={item.key} className="flex gap-3">
          <StepNumber>{index + 1}</StepNumber>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-body-sm font-medium text-foreground">{item.title}</p>
            {item.body ? (
              <div className="max-w-reading space-y-1.5 text-body-sm text-foreground-secondary">{item.body}</div>
            ) : null}
            {item.children ? <div className="space-y-3 pt-1">{item.children}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-6 shrink-0 items-center" aria-hidden="true">
      <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface-1 font-mono text-micro text-muted-foreground">
        {children}
      </span>
    </span>
  )
}

/** Term → value rows in a hairline frame: where, with which key, which endpoint. */
export function FactList({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border-faint overflow-hidden rounded-panel border border-border text-caption", className)}>
      {rows.map(([term, value], index) => (
        <div key={index} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 text-foreground-secondary">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * "How do I know it worked": the same editorial note as the guide's promise —
 * a success edge on a quiet surface, never a coloured box.
 */
export function ExpectedResult({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex max-w-reading items-start gap-3 rounded-r-control border-l-2 border-success bg-surface-1 px-4 py-3 text-caption">
      <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-0.5 space-y-1 text-foreground-secondary">{children}</div>
      </div>
    </div>
  )
}

/** A worked example over time: day, what happens, what it means. */
export function Timeline({
  items,
  label,
}: {
  items: { key: string; when: string; title: React.ReactNode; note?: React.ReactNode; muted?: boolean }[]
  label: string
}) {
  return (
    <ol aria-label={label} className="rounded-panel border border-border bg-surface-1 px-4 py-4">
      {items.map((item, index) => {
        const last = index === items.length - 1
        return (
          <li key={item.key} className="flex gap-3">
            <span className="w-14 shrink-0 pt-px font-mono text-meta text-muted-foreground">{item.when}</span>
            <span className="flex shrink-0 flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  "mt-1.5 size-2 rounded-full border",
                  item.muted ? "border-border-strong bg-surface-1" : "border-foreground bg-foreground",
                )}
              />
              {last ? null : <span className="w-px flex-1 bg-border" />}
            </span>
            <div className={cn("min-w-0 flex-1 text-caption", !last && "pb-4")}>
              <p className={cn("font-medium", item.muted ? "text-muted-foreground" : "text-foreground")}>{item.title}</p>
              {item.note ? <p className="mt-0.5 text-muted-foreground">{item.note}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** States in order, as small labels joined by arrows; wraps on narrow screens. */
export function StateFlow({ states, label }: { states: { key: string; label: string; tone?: "neutral" | "end" }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {states.map((state, index) => (
        <li key={state.key} className="flex items-center gap-1.5">
          {index > 0 ? <ArrowRight className="size-3.5 text-faint-foreground" aria-hidden="true" /> : null}
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-badge border px-2 text-meta",
              state.tone === "end"
                ? "border-border-strong bg-surface-1 text-foreground"
                : "border-border bg-fill text-foreground-secondary",
            )}
          >
            {state.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
