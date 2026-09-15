"use client"

import { useLocale, useTimeZone } from "next-intl"
import { useMemo } from "react"

import { createFormatters, type Formatters } from "@/lib/money"

/**
 * The client counterpart of `getFormatters()`. The zone comes from the nearest
 * `NextIntlClientProvider`; the workspace layouts set it to the workspace's.
 */
export function useFormatters(): Formatters {
  const locale = useLocale()
  const timeZone = useTimeZone()
  return useMemo(() => createFormatters(locale, timeZone ?? "UTC"), [locale, timeZone])
}
