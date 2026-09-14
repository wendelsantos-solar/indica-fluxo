import { Coins, CreditCard, MousePointerClick, UserPlus, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import type { ReactNode } from "react"

import { StatusBadge } from "@/components/ui/badge"
import { DEFAULT_CURRENCY, routing, type Locale } from "@/i18n/routing"
import { applyBasisPoints, createFormatters } from "@/lib/money"

/** An illustrative plan price and a 20% rate, in the reader's usual currency. */
const PLAN_MINOR: Record<Locale, number> = { "pt-br": 29400, en: 9800 }
const RATE_BASIS_POINTS = 2000

/**
 * The auth screens' one piece of decoration, and it is the product: a single
 * referral traced from click to commission, drawn with the same hairlines,
 * tabular figures and status badge as the ledger. Purely illustrative —
 * `aria-hidden`, no customer, no testimonial, no metric that claims anything.
 */
export function AuthProof({ className }: { className?: string }) {
  const t = useTranslations("auth.proof")
  const raw = useLocale()
  const locale: Locale = (routing.locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : routing.defaultLocale

  const f = createFormatters(locale)
  const currency = DEFAULT_CURRENCY[locale]
  const plan = f.money(PLAN_MINOR[locale], currency)
  const commission = f.money(applyBasisPoints(PLAN_MINOR[locale], RATE_BASIS_POINTS), currency)
  const rate = f.basisPoints(RATE_BASIS_POINTS)
  const initials = t("affiliate")
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")

  const steps: {
    icon: LucideIcon
    label: string
    detail: string
    aside?: ReactNode
  }[] = [
    {
      icon: MousePointerClick,
      label: t("click"),
      detail: t("clickDetail"),
      aside: <span className="font-mono text-meta text-faint-foreground">{t("reference")}</span>,
    },
    { icon: UserPlus, label: t("signup"), detail: t("signupDetail") },
    {
      icon: CreditCard,
      label: t("customer"),
      detail: t("customerDetail"),
      aside: <span className="text-caption tabular-nums text-foreground-secondary">{plan}</span>,
    },
    {
      icon: Coins,
      label: t("commission"),
      detail: t("commissionDetail", { rate, amount: plan }),
      aside: (
        <span className="flex items-center gap-2">
          <span className="text-caption font-medium tabular-nums text-foreground">{commission}</span>
          <StatusBadge status="approved" />
        </span>
      ),
    },
  ]

  return (
    <div aria-hidden="true" className={className}>
      <div className="rounded-panel border border-border bg-surface-1">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex size-6 items-center justify-center rounded-full bg-fill text-micro text-foreground-secondary">
            {initials}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
            {t("affiliate")}
          </span>
          <span className="truncate text-meta text-faint-foreground">{t("program")}</span>
        </div>

        <ol className="px-4 pt-4">
          {steps.map((step, index) => {
            const last = index === steps.length - 1
            return (
              <li key={step.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-control border border-border bg-fill-subtle text-muted-foreground">
                    <step.icon className="size-3.5" />
                  </span>
                  {!last ? <span className="my-1 w-px flex-1 bg-border" /> : null}
                </div>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pb-4">
                  <div className="min-w-0">
                    <p className="text-caption text-foreground">{step.label}</p>
                    <p className="truncate text-meta text-muted-foreground">{step.detail}</p>
                  </div>
                  {step.aside ? <div className="shrink-0 pt-0.5">{step.aside}</div> : null}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
