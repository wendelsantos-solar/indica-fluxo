/**
 * Calendar arithmetic in a workspace's IANA time zone.
 *
 * A ledger's dates are calendar facts of the workspace: a payment at 22:00 in
 * São Paulo happened "today" there, even though it is already tomorrow in UTC.
 * Windows ("last 30 days"), day buckets and batch months are therefore
 * computed on the workspace's wall clock, then turned back into instants for
 * SQL. Pure (no I/O, no React) so the rules are unit-tested.
 */

export const DEFAULT_TIME_ZONE = "UTC"

/** `Intl.supportedValuesOf` lists canonical zones only, and not "UTC" itself. */
const ALWAYS_SUPPORTED = new Set(["UTC", "Etc/UTC"])

let supported: Set<string> | null = null

function supportedZones(): Set<string> {
  if (!supported) {
    let zones: string[] = []
    try {
      zones = Intl.supportedValuesOf("timeZone")
    } catch {
      zones = []
    }
    supported = new Set([...zones, ...ALWAYS_SUPPORTED])
  }
  return supported
}

/**
 * Whether `value` is a zone this runtime knows by its canonical IANA name.
 * Anything that reaches SQL as `AT TIME ZONE $1` passes through here first, so
 * a hand-edited column can never become an unknown zone (a 500) — or text.
 */
export function isSupportedTimeZone(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && supportedZones().has(value)
}

/** The workspace's zone when it is a supported one, otherwise UTC. */
export function resolveTimeZone(value: string | null | undefined): string {
  return isSupportedTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

export interface CalendarDate {
  year: number
  /** 1–12. */
  month: number
  day: number
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsFormatters.set(timeZone, formatter)
  }
  return formatter
}

function wallClock(instant: Date, timeZone: string) {
  const values: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value)
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

/** Offset of the zone from UTC at an instant, in milliseconds (São Paulo: −3 h). */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClock(new Date(instant), timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** The calendar date an instant falls on in a zone. */
export function calendarDateIn(instant: Date, timeZone: string): CalendarDate {
  const { year, month, day } = wallClock(instant, timeZone)
  return { year, month, day }
}

/** `{2026, 9, 4}` → `"2026-09-04"` — the key a day bucket carries. */
export function dateKey(date: CalendarDate): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0")
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`
}

/** The local date key of an instant: what "which day was it" means for the workspace. */
export function localDateKey(instant: Date, timeZone: string): string {
  return dateKey(calendarDateIn(instant, timeZone))
}

/** Calendar addition, month and year lengths included (`31 Jan + 1 day = 1 Feb`). */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

/**
 * The first instant of a calendar date in a zone — local midnight, or the
 * first valid wall-clock time on a day whose midnight a DST jump skips.
 */
export function startOfDayIn(date: CalendarDate, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day)
  const key = dateKey(date)
  // The offset at midnight may differ from the offset at the guess (a DST
  // change in between); both candidates are tried and the earliest instant
  // that still falls on the requested date wins.
  const first = guess - offsetAt(guess, timeZone)
  const second = guess - offsetAt(first, timeZone)
  const candidates = [...new Set([first, second])].sort((a, b) => a - b)
  const match = candidates.find((candidate) => localDateKey(new Date(candidate), timeZone) === key)
  return new Date(match ?? second)
}

export interface LocalDayRange {
  /** Local midnight of the first day in the window. */
  start: Date
  /** Local midnight of the first day of the window of the same length just before. */
  previousStart: Date
  /** One `YYYY-MM-DD` per day, oldest first; the last one is today. */
  keys: string[]
}

/**
 * "The last `days` days" on the workspace's wall clock: today plus the
 * `days - 1` days before it, starting at local midnight — so a chart with
 * `days` points and the metrics next to it cover exactly the same span.
 */
export function localDayRange(now: Date, timeZone: string, days: number): LocalDayRange {
  const count = Math.max(1, Math.floor(days))
  const today = calendarDateIn(now, timeZone)
  const first = addCalendarDays(today, -(count - 1))
  const keys = Array.from({ length: count }, (_, index) => dateKey(addCalendarDays(first, index)))
  return {
    start: startOfDayIn(first, timeZone),
    previousStart: startOfDayIn(addCalendarDays(first, -count), timeZone),
    keys,
  }
}

/**
 * The calendar month `now` falls in on the workspace's wall clock, as the
 * payout batch stores it: first and last day, each at 00:00 UTC. The bounds
 * are dates, not instants, so they are always rendered in UTC.
 */
export function localMonthPeriod(now: Date, timeZone: string): { periodStart: Date; periodEnd: Date } {
  const { year, month } = calendarDateIn(now, timeZone)
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    periodEnd: new Date(Date.UTC(year, month, 0)),
  }
}
