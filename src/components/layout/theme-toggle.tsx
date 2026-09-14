"use client"

import { Monitor, Moon, Sun } from "lucide-react"
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
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  // The resolved theme is unknown on the server, so render a stable
  // placeholder rather than guessing and flipping after hydration.
  const mounted = useHydrated()

  const Icon = !mounted ? Monitor : resolvedTheme === "light" ? Sun : Moon

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
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
            {option.label}
          </DropdownCheckItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
