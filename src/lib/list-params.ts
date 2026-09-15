import { z } from "zod"

import { addCalendarDays, calendarDateIn, localDayRange, startOfDayIn } from "@/lib/time-zone"

/**
 * Parsing a list page's search params — sort, page, id filters, period — is
 * the boundary between a URL anyone can type and the repository's `ORDER BY`
 * and `OFFSET`. Everything is whitelisted and clamped here, so a stale or
 * hand-edited link can never reach SQL as anything but a known value.
 *
 * Pure (no I/O, no React) so the rules are unit-tested.
 */

export type SortDirection = "asc" | "desc"

export interface SortState<Field extends string> {
  field: Field
  dir: SortDirection
}

type RawParam = string | string[] | undefined

/** The first value of a repeated param (`?sort=a&sort=b` → `a`). */
export function firstParam(value: RawParam): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `?sort=field&dir=asc|desc`. An unknown field falls back to the default sort
 * entirely (its direction included); a known field without a valid `dir` takes
 * that field's natural direction — newest/largest first for dates and money,
 * A→Z for names.
 */
export function parseSort<const Field extends string>(
  raw: { sort?: RawParam; dir?: RawParam },
  config: {
    fields: readonly Field[]
    defaultSort: SortState<Field>
    /** Direction used when `dir` is missing; defaults to `desc`. */
    naturalDir?: Partial<Record<Field, SortDirection>>
  },
): SortState<Field> {
  const fieldSchema = z.enum(config.fields as unknown as [Field, ...Field[]])
  const field = fieldSchema.safeParse(firstParam(raw.sort))
  if (!field.success) return config.defaultSort

  const dir = z.enum(["asc", "desc"]).safeParse(firstParam(raw.dir))
  return {
    field: field.data,
    dir: dir.success ? dir.data : (config.naturalDir?.[field.data] ?? "desc"),
  }
}

/**
 * The link a sortable column header points at: clicking the active column
 * flips its direction; clicking another column starts at its natural one.
 */
export function nextSort<Field extends string>(
  current: SortState<Field>,
  field: Field,
  naturalDir: SortDirection = "desc",
): SortState<Field> {
  if (current.field === field) return { field, dir: current.dir === "asc" ? "desc" : "asc" }
  return { field, dir: naturalDir }
}

/** `?page=2.5` → 2, `?page=-1` / `?page=abc` → 1. Always a positive integer. */
export function parsePage(raw: RawParam): number {
  const value = Number(firstParam(raw))
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(Math.floor(value), 1_000_000))
}

export interface PageWindow {
  page: number
  /** At least 1, so "página 1 de 1" reads correctly for an empty list. */
  pages: number
  offset: number
  /** The requested page lies after the last one (a stale or edited link). */
  pastEnd: boolean
}

/**
 * Where a page sits against the total. `page` is kept as requested (so the
 * summary can say which page was asked for is empty) but `pastEnd` tells the
 * view to show "no results on this page" instead of a first-run empty state.
 */
export function pageWindow(page: number, total: number, pageSize: number): PageWindow {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
  return {
    page,
    pages,
    offset: (page - 1) * pageSize,
    pastEnd: total > 0 && page > pages,
  }
}

const uuid = z.string().uuid()

/** An id filter (`?affiliate=`), accepted only when it is a UUID. */
export function parseUuidParam(raw: RawParam): string | undefined {
  const parsed = uuid.safeParse(firstParam(raw))
  return parsed.success ? parsed.data : undefined
}

export const PERIODS = ["7d", "30d", "90d", "12m"] as const
export type Period = (typeof PERIODS)[number]

/** `?period=`; anything else (or nothing) means "all time". */
export function parsePeriod(raw: RawParam): Period | undefined {
  const parsed = z.enum(PERIODS).safeParse(firstParam(raw))
  return parsed.success ? parsed.data : undefined
}

/** The start of a period, counted back from `now`. */
export function periodStart(period: Period, now: Date): Date {
  const start = new Date(now)
  switch (period) {
    case "7d":
      start.setUTCDate(start.getUTCDate() - 7)
      break
    case "30d":
      start.setUTCDate(start.getUTCDate() - 30)
      break
    case "90d":
      start.setUTCDate(start.getUTCDate() - 90)
      break
    case "12m":
      start.setUTCFullYear(start.getUTCFullYear() - 1)
      break
  }
  return start
}

const PERIOD_DAYS: Record<Exclude<Period, "12m">, number> = { "7d": 7, "30d": 30, "90d": 90 }

/**
 * The start of a period on the workspace's wall clock: `7d` is today and the
 * six days before it, from local midnight — the same span the overview's
 * "last N days" covers. `12m` starts the day after the same date a year ago.
 * Use this for views inside a workspace; `periodStart` stays the rolling,
 * zone-less count.
 */
export function periodStartInZone(period: Period, now: Date, timeZone: string): Date {
  if (period === "12m") {
    const today = calendarDateIn(now, timeZone)
    const yearAgo = { ...today, year: today.year - 1 }
    return startOfDayIn(addCalendarDays(yearAgo, 1), timeZone)
  }
  return localDayRange(now, timeZone, PERIOD_DAYS[period]).start
}

/** A trimmed, length-capped free-text search, or undefined when blank. */
export function parseSearch(raw: RawParam, maxLength = 100): string | undefined {
  const value = firstParam(raw)?.trim()
  return value ? value.slice(0, maxLength) : undefined
}
