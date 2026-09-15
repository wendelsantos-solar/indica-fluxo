"use client"

import { Languages } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import * as React from "react"

import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { usePathname, useRouter } from "@/i18n/navigation"
import { LOCALE_LABEL, routing, type Locale } from "@/i18n/routing"
import { useHydrated } from "@/components/ui/use-hydrated"
import { cn } from "@/lib/utils"

/**
 * Switches locale without losing the reader's place.
 *
 * `usePathname` from `@/i18n/navigation` returns the canonical path with the
 * locale and any pathname translation already reversed, so pushing it under a
 * different locale lands on the same page with the other spelling —
 * `/pt-br/acme/comissoes` becomes `/en/acme/commissions`, not the home page.
 */
type AppRouter = ReturnType<typeof useRouter>
type ReplaceHref = Parameters<AppRouter["replace"]>[0]

/**
 * Replaces the current route under another locale, keeping dynamic params, so
 * the reader stays on the same page. Shared by the switcher, the account menu
 * and the command palette.
 */
export function useSwitchLocale() {
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  // Carries `workspaceSlug` / `programSlug` on dynamic routes; `{}` elsewhere.
  const params = useParams()
  const [pending, startTransition] = React.useTransition()

  const select = React.useCallback(
    (next: Locale) => {
      if (next === locale) return
      startTransition(() => {
        // The canonical pathname is only known at runtime, so its params cannot
        // be narrowed to one route's shape; widen to what `replace` accepts
        // rather than to `any`, which would drop the locale check too.
        router.replace({ pathname, params } as ReplaceHref, { locale: next })
      })
    },
    [locale, pathname, params, router],
  )

  return { locale, select, pending }
}

export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common.locale")
  const hydrated = useHydrated()
  const { locale, select, pending } = useSwitchLocale()

  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={t("label")}
        disabled={!hydrated || pending}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-control text-muted-foreground",
          "transition-colors duration-[120ms] hover:bg-hover hover:text-foreground",
          "disabled:opacity-60",
          className,
        )}
      >
        <Languages className="size-4" aria-hidden="true" />
      </DropdownTrigger>

      <DropdownContent align="end" className="w-[200px]">
        <DropdownLabel>{t("label")}</DropdownLabel>
        {routing.locales.map((option) => (
          <DropdownItem
            key={option}
            onSelect={() => select(option)}
            aria-current={option === locale ? "true" : undefined}
            className="justify-between"
          >
            <span>{LOCALE_LABEL[option]}</span>
            {option === locale ? (
              <span className="text-meta text-muted-foreground">{t("current")}</span>
            ) : null}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
