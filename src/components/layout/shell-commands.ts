"use client"

import { Languages, LayoutDashboard, LogOut, Monitor, Moon, Sun, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import * as React from "react"

import { useRouter } from "@/i18n/navigation"
import { LOCALE_LABEL, routing } from "@/i18n/routing"

import type { Command } from "@/components/layout/command-palette"
import { useSwitchLocale } from "@/components/layout/locale-switcher"

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const

/** Palette commands every signed-in surface shares: theme, language, portal, sign out. */
export function useShellCommands({ portal }: { portal: "affiliate" | "dashboard" }): Command[] {
  const t = useTranslations("palette")
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { locale, select } = useSwitchLocale()

  return React.useMemo<Command[]>(() => {
    const themes = (["light", "dark", "system"] as const)
      .filter((value) => value !== theme)
      .map<Command>((value) => ({
        id: `theme-${value}`,
        group: "actions",
        label: t(`theme.${value}`),
        icon: THEME_ICON[value],
        keywords: "theme tema appearance aparência",
        run: () => setTheme(value),
      }))
    const languages = routing.locales
      .filter((value) => value !== locale)
      .map<Command>((value) => ({
        id: `locale-${value}`,
        group: "actions",
        label: t("switchLanguage", { language: LOCALE_LABEL[value] }),
        icon: Languages,
        keywords: "language idioma",
        run: () => select(value),
      }))
    return [
      ...themes,
      ...languages,
      portal === "affiliate"
        ? {
            id: "portal",
            group: "actions",
            label: t("affiliatePortal"),
            icon: User,
            run: () => router.push("/affiliate/overview"),
          }
        : {
            id: "portal",
            group: "actions",
            label: t("dashboard"),
            icon: LayoutDashboard,
            run: () => router.push("/app"),
          },
      {
        id: "sign-out",
        group: "actions",
        label: t("signOut"),
        icon: LogOut,
        // A full navigation: the logout route clears the session server-side.
        run: () => router.push("/logout"),
      },
    ]
  }, [t, router, theme, setTheme, locale, select, portal])
}
