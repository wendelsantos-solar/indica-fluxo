"use client"

import { Link, usePathname } from "@/i18n/navigation"

import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

export type AffiliateNavItem = {
  href: "/affiliate/overview" | "/affiliate/links" | "/affiliate/conversions" | "/affiliate/commissions" | "/affiliate/payouts" | "/affiliate/settings"
  label: string
}

export function AffiliateNav({ items }: { items: AffiliateNavItem[] }) {
  const t = useTranslations("nav")
  const pathname = usePathname()

  return (
    <nav
      aria-label={t("affiliateSections")}
      data-slot="scrollable"
      className="sticky top-14 z-20 overflow-x-auto border-b border-border bg-background/85 backdrop-blur-[2px]"
    >
      <ul className="mx-auto flex w-full max-w-[1100px] items-center gap-1 px-4 sm:px-6">
        {items.map((item) => {
          const active = pathname === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative block whitespace-nowrap px-3 py-2.5 text-caption font-medium transition-colors duration-[120ms]",
                  active
                    ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground-secondary",
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
