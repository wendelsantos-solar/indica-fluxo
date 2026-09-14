"use client"

import { ChartNoAxesColumn, Coins, CreditCard, Link2, Receipt, Settings2 } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link } from "@/i18n/navigation"

import { AccountMenu } from "@/components/layout/account-menu"
import { AppShell, type NavItem, type NavSection } from "@/components/layout/app-shell"
import { Logo } from "@/components/layout/logo"
import { useShellCommands } from "@/components/layout/shell-commands"

type AffiliatePage = "overview" | "links" | "conversions" | "commissions" | "payouts" | "settings"

/**
 * The affiliate portal's frame. Same shell as the dashboard, so a founder who
 * is also an affiliate never learns two products; on a phone it is an app bar
 * and a drawer, which is where affiliates check their earnings.
 */
export function AffiliateShell({
  email,
  name,
  children,
}: {
  email: string
  name?: string | null
  children: React.ReactNode
}) {
  const t = useTranslations("nav")

  const { sections, footer } = React.useMemo(() => {
    const item = (key: AffiliatePage, icon: NavItem["icon"], chord: string): NavItem => ({
      key,
      label: t(key),
      href: `/affiliate/${key}`,
      path: `/affiliate/${key}`,
      icon,
      chord,
    })
    const sections: NavSection[] = [
      { key: "home", items: [item("overview", ChartNoAxesColumn, "o"), item("links", Link2, "l")] },
      {
        key: "earnings",
        label: t("sections.earnings"),
        items: [
          item("conversions", Receipt, "c"),
          item("commissions", Coins, "m"),
          item("payouts", CreditCard, "y"),
        ],
      },
    ]
    return { sections, footer: [item("settings", Settings2, "s")] }
  }, [t])

  const commands = useShellCommands({ portal: "dashboard" })

  return (
    <AppShell
      brand={
        <Link
          href="/affiliate/overview"
          aria-label={t("portalHome")}
          className="flex h-8 items-center rounded-control px-1.5"
        >
          <Logo />
        </Link>
      }
      sections={sections}
      footer={footer}
      account={<AccountMenu email={email} name={name} portal="dashboard" />}
      commands={commands}
    >
      {children}
    </AppShell>
  )
}
