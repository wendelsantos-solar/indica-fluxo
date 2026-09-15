import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge only knows Tailwind's default type scale, so it would read
 * `text-caption` as a text *colour* and drop it next to `text-foreground`.
 * Registering the scale from `src/design/theme.css` keeps size and colour apart.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "micro",
        "label",
        "meta",
        "caption",
        "ui",
        "body-sm",
        "body",
        "body-md",
        "title",
        "body-lg",
        "subheading",
        "heading-sm",
        "heading",
        "heading-lg",
        "display",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** URL- and referral-code-safe slug. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  const day = next.getUTCDate()
  next.setUTCMonth(next.getUTCMonth() + months)
  // Clamp end-of-month overflow: 31 Jan + 1 month is 28/29 Feb, not 2/3 Mar.
  if (next.getUTCDate() < day) next.setUTCDate(0)
  return next
}
