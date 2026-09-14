"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

export function AffiliateNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Affiliate sections"
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
                  "relative block whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors duration-[120ms]",
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
