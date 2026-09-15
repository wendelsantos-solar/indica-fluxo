"use client"

import { NextIntlClientProvider, useLocale } from "next-intl"
import type * as React from "react"

/**
 * Sets the time zone every client component under a workspace formats dates
 * in (`useFormatters()`, `useTimeZone()`, `useFormatter()`).
 *
 * A client provider on purpose: the server-rendered `NextIntlClientProvider`
 * fills in messages and formats itself, which would serialise the whole
 * catalogue a second time. The client `IntlProvider` inherits every prop left
 * undefined from the root provider (`app/[locale]/layout.tsx`), so only the
 * zone changes. Server components get the same zone through
 * `getFormatters(workspace.timezone)`.
 */
export function WorkspaceTimeZone({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  const locale = useLocale()
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  )
}
