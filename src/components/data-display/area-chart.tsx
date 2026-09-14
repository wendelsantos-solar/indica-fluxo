"use client"

import * as React from "react"

import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

/**
 * Hand-rolled SVG rather than a charting library: the series is already
 * aggregated in SQL (ARCHITECTURE.md §6), so there is nothing for a library to
 * do except ship 100kB. DESIGN.md §10 governs the visual rules.
 */

export interface Series {
  key: string
  label: string
  color: string
  values: number[]
}

export function AreaChart({
  labels,
  series,
  currency,
  height = 220,
  className,
}: {
  labels: string[]
  series: Series[]
  currency: string
  height?: number
  className?: string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  const width = 800
  const padding = { top: 12, right: 8, bottom: 24, left: 8 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const count = labels.length

  const x = (i: number) => padding.left + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW)
  const y = (v: number) => padding.top + innerH - (v / max) * innerH

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${series.map((s) => s.label).join(" and ")} over ${count} days`}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((g) => (
          <line
            key={g}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerH * g}
            y2={padding.top + innerH * g}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}

        {series.map((s) => {
          const line = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ")
          const area = `${line} L ${x(count - 1)} ${padding.top + innerH} L ${x(0)} ${padding.top + innerH} Z`
          return (
            <g key={s.key}>
              <defs>
                <linearGradient id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#grad-${s.key})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={1.5} />
            </g>
          )
        })}

        {hover !== null ? (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padding.top}
              y2={padding.top + innerH}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={3}
                fill={s.color}
                stroke="var(--surface-1)"
                strokeWidth={1.5}
              />
            ))}
          </>
        ) : null}

        {labels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - innerW / Math.max(1, count) / 2}
            y={padding.top}
            width={innerW / Math.max(1, count)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div className="mt-1 flex justify-between text-label text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>

      {hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 rounded-control border border-border bg-surface-3 px-2.5 py-2 shadow-[var(--shadow-overlay)]"
          style={{
            left: `calc(${((hover / Math.max(1, count - 1)) * 100).toFixed(2)}% - 60px)`,
          }}
        >
          <p className="mb-1 text-label text-muted-foreground">{labels[hover]}</p>
          {[...series]
            .sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0))
            .map((s) => (
              <p key={s.key} className="flex items-center gap-2 text-meta">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-foreground">
                  {formatMoney(s.values[hover] ?? 0, currency, { compact: true })}
                </span>
              </p>
            ))}
        </div>
      ) : null}
    </div>
  )
}

export function ChartLegend({ series }: { series: Pick<Series, "key" | "label" | "color">[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  )
}
