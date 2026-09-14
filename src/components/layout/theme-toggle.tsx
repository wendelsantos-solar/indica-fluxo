"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"

import {
  Dropdown,
  DropdownCheckItem,
  DropdownContent,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/components/ui/use-hydrated"

const OPTIONS = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const

/**
 * Public chrome only (marketing, auth, onboarding). Sized to sit beside the
 * locale switcher as a matched pair of 32px icon controls; inside the product
 * the theme lives in the account menu instead.
 */
export function ThemeToggle() {
  const t = useTranslations("common.theme")
  const { theme, setTheme, resolvedTheme } = useTheme()
  // The resolved theme is unknown on the server, so render a stable
  // placeholder rather than guessing and flipping after hydration.
  const mounted = useHydrated()

  const Icon = !mounted ? Monitor : resolvedTheme === "light" ? Sun : Moon

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("label")}>
          <Icon aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        {OPTIONS.map((option) => (
          <DropdownCheckItem
            key={option.value}
            checked={mounted && theme === option.value}
            onSelect={() => setTheme(option.value)}
          >
            <option.icon aria-hidden="true" />
            {t(option.value)}
          </DropdownCheckItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
