import { LogOut, User } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
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
  const t = useTranslations("common.account")

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-[2px] sm:px-6">
      <div className="min-w-0 flex-1">{children}</div>
      <LocaleSwitcher />
      <ThemeToggle />
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-micro font-medium text-foreground-secondary transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={t("menu")}
          >
            {initials(name || email)}
          </button>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-[220px]">
          <DropdownLabel>{t("signedInAs")}</DropdownLabel>
          <p className="truncate px-2 pb-2 text-caption text-foreground-secondary">{email}</p>
          <DropdownSeparator />
          {!affiliatePortal ? (
            <DropdownItem asChild>
              <Link href="/affiliate/overview">
                <User aria-hidden="true" />
                {t("affiliatePortal")}
              </Link>
            </DropdownItem>
          ) : null}
          <DropdownItem asChild>
            <Link href="/logout" prefetch={false}>
              <LogOut aria-hidden="true" />
              {t("signOut")}
            </Link>
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </header>
  )
}
