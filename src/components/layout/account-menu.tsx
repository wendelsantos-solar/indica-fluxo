"use client"

import { LayoutDashboard, LogOut, Monitor, Moon, Sun, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"

import { Link } from "@/i18n/navigation"
import { LOCALE_LABEL, routing } from "@/i18n/routing"

import { RailTooltip, SIDEBAR_CENTER_IN_RAIL, SIDEBAR_LABEL } from "@/components/layout/app-shell"
import { useSwitchLocale } from "@/components/layout/locale-switcher"
import {
  Dropdown,
  DropdownCheckItem,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { useHydrated } from "@/components/ui/use-hydrated"
import { cn, initials } from "@/lib/utils"

const THEMES = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const

/**
 * The sidebar's bottom row: who is signed in, and the per-person preferences
 * (theme, language) that have no page of their own. Collapses to the avatar
 * in the icon rail.
 */
export function AccountMenu({
  email,
  name,
  portal,
}: {
  email: string
  name?: string | null
  /** Which other surface this person can jump to. */
  portal: "affiliate" | "dashboard" | null
}) {
  const t = useTranslations("common.account")
  const tt = useTranslations("common.theme")
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const { locale, select } = useSwitchLocale()

  return (
    <Dropdown>
      <RailTooltip label={name || email}>
        <DropdownTrigger asChild>
          <button
            type="button"
            aria-label={t("menu")}
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-control px-1.5 text-left transition-colors duration-[120ms] hover:bg-hover touch:h-11",
              SIDEBAR_CENTER_IN_RAIL,
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-strong text-micro text-foreground-secondary">
              {initials(name || email)}
            </span>
            <span className={cn(SIDEBAR_LABEL, "min-w-0 flex-1 truncate text-caption text-muted-foreground")}>
              {name || email}
            </span>
          </button>
        </DropdownTrigger>
      </RailTooltip>
      <DropdownContent side="top" align="start" className="w-[240px]">
        <DropdownLabel>{t("signedInAs")}</DropdownLabel>
        <p className="truncate px-2 pb-2 text-caption text-foreground-secondary">{email}</p>
        <DropdownSeparator />
        <DropdownLabel>{t("theme")}</DropdownLabel>
        {THEMES.map((option) => (
          <DropdownCheckItem
            key={option.value}
            checked={hydrated && theme === option.value}
            onSelect={() => setTheme(option.value)}
          >
            <option.icon aria-hidden="true" />
            {tt(option.value)}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        <DropdownLabel>{t("language")}</DropdownLabel>
        {routing.locales.map((option) => (
          <DropdownCheckItem
            key={option}
            checked={option === locale}
            onSelect={() => select(option)}
          >
            {LOCALE_LABEL[option]}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        {portal ? (
          <DropdownItem asChild>
            {portal === "affiliate" ? (
              <Link href="/affiliate/overview">
                <User aria-hidden="true" />
                {t("affiliatePortal")}
              </Link>
            ) : (
              <Link href="/app">
                <LayoutDashboard aria-hidden="true" />
                {t("dashboard")}
              </Link>
            )}
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
  )
}
