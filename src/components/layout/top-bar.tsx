import { LogOut, User } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { ThemeToggle } from "@/components/layout/theme-toggle"
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { initials } from "@/lib/utils"

export function TopBar({
  email,
  name,
  affiliatePortal = false,
  children,
}: {
  email: string
  name?: string | null
  affiliatePortal?: boolean
  children?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-[2px] sm:px-6">
      <div className="min-w-0 flex-1">{children}</div>
      <ThemeToggle />
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-micro font-medium text-foreground-secondary transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Account menu"
          >
            {initials(name || email)}
          </button>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-[220px]">
          <DropdownLabel>Signed in as</DropdownLabel>
          <p className="truncate px-2 pb-2 text-caption text-foreground-secondary">{email}</p>
          <DropdownSeparator />
          {!affiliatePortal ? (
            <DropdownItem asChild>
              <Link href="/affiliate/overview">
                <User aria-hidden="true" />
                Affiliate portal
              </Link>
            </DropdownItem>
          ) : null}
          <DropdownItem asChild>
            <Link href="/logout" prefetch={false}>
              <LogOut aria-hidden="true" />
              Sign out
            </Link>
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </header>
  )
}
