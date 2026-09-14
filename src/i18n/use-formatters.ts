"use client"

import { useLocale } from "next-intl"
import { useMemo } from "react"

import { createFormatters, type Formatters } from "@/lib/money"

/** The client counterpart of `getFormatters()`. */
export function useFormatters(): Formatters {
  const locale = useLocale()
  return useMemo(() => createFormatters(locale), [locale])
}
