"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useFormatters } from "@/i18n/use-formatters"

/**
 * Hand-rolled SVG rather than a charting library: the series is already
 * aggregated in SQL (ARCHITECTURE.md §6), so there is nothing for a library to
 * do except ship 100kB. DESIGN.md §10 governs the visual rules: hairline
 * horizontal grid only, muted 12px axis labels, no chart junk.
 *
 * The SVG stretches to its container (`preserveAspectRatio="none"`) with
 * non-scaling strokes, so a hairline stays a hairline at every width. Anything
 * that must stay round — the hover dots — is drawn in HTML on top.
 */

export interface Series {
  key: string
  label: string
  color: string
  values: number[]
}

const WIDTH = 800
const PADDING = { top: 8, right: 0, bottom: 0, left: 0 }
const GRID = [0, 1 / 3, 2 / 3, 1]

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
  const f = useFormatters()
  const id = React.useId()
  const [hover, setHover] = React.useState<number | null>(null)
  const innerW = WIDTH - PADDING.left - PADDING.right
  const innerH = height - PADDING.top - PADDING.bottom

  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const count = labels.length

  const x = (i: number) => PADDING.left + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW)
  const y = (v: number) => PADDING.top + innerH - (v / max) * innerH
  const pctX = (i: number) => (x(i) / WIDTH) * 100
  const pctY = (v: number) => (y(v) / height) * 100

  // Five evenly spaced ticks at most; a date under every point is noise.
  const tickCount = Math.min(count, 5)
  const ticks =
    tickCount <= 1
      ? [0]
      : Array.from({ length: tickCount }, (_, n) => Math.round((n / (tickCount - 1)) * (count - 1)))

  const hoverLeft = hover !== null ? pctX(hover) : 0

  return (
    <div className={cn("relative", className)} onMouseLeave={() => setHover(null)}>
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          role="img"
          aria-label={series.map((s) => s.label).join(" · ")}
        >
          {GRID.map((g) => (
            <line
              key={g}
              x1={0}
              x2={WIDTH}
              y1={PADDING.top + innerH * g}
              y2={PADDING.top + innerH * g}
              stroke={g === 1 ? "var(--border)" : "var(--border-faint)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s) => {
            const line = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ")
            const area = `${line} L ${x(Math.max(0, count - 1))} ${PADDING.top + innerH} L ${x(0)} ${PADDING.top + innerH} Z`
            const gradient = `${id}-${s.key}`
            return (
              <g key={s.key}>
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={area} fill={`url(#${gradient})`} />
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}

          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PADDING.top}
              y2={PADDING.top + innerH}
              stroke="var(--border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {labels.map((_, i) => (
            <rect
              key={i}
              x={x(i) - innerW / Math.max(1, count) / 2}
              y={0}
              width={innerW / Math.max(1, count)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {hover !== null
          ? series.map((s) => (
              <span
                key={s.key}
                aria-hidden="true"
                className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-1"
                style={{
                  left: `${pctX(hover)}%`,
                  top: `${pctY(s.values[hover] ?? 0)}%`,
                  backgroundColor: s.color,
                }}
              />
            ))
          : null}

        {hover !== null ? (
          <div
            className={cn(
              "pointer-events-none absolute top-0 z-10 min-w-36 rounded-control bg-surface-3 px-2.5 py-2 shadow-overlay",
              // Flip to the left of the cursor line near the right edge.
              hoverLeft > 65 ? "mr-3" : "ml-3",
            )}
            style={hoverLeft > 65 ? { right: `${100 - hoverLeft}%` } : { left: `${hoverLeft}%` }}
          >
            <p className="mb-1 text-meta text-muted-foreground">{labels[hover]}</p>
            {[...series]
              .sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0))
              .map((s) => (
                <p key={s.key} className="flex items-center gap-2 text-meta">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto pl-3 tabular-nums text-foreground">
                    {f.money(s.values[hover] ?? 0, currency, { compact: true })}
                  </span>
                </p>
              ))}
          </div>
        ) : null}
      </div>

      <div className="relative mt-2 h-4 text-meta tabular-nums text-muted-foreground">
        {ticks.map((i, n) => (
          <span
            key={i}
            className={cn(
              "absolute top-0 whitespace-nowrap",
              n === 0 ? "left-0" : n === ticks.length - 1 ? "right-0" : "-translate-x-1/2 max-sm:hidden",
            )}
            style={n === 0 || n === ticks.length - 1 ? undefined : { left: `${pctX(i)}%` }}
          >
            {labels[i]}
          </span>
        ))}
      </div>
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
