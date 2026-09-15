"use client"

import { ChartNoAxesColumn, Coins, CreditCard, Link2, Plus, Receipt, Settings2 } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link, useRouter } from "@/i18n/navigation"

import { AccountMenu } from "@/components/layout/account-menu"
import { AppShell, SIDEBAR_CENTER_IN_RAIL, SIDEBAR_LABEL, type NavItem, type NavSection } from "@/components/layout/app-shell"
import type { Command } from "@/components/layout/command-palette"
import { Logo } from "@/components/layout/logo"
import { useShellCommands } from "@/components/layout/shell-commands"
import { cn } from "@/lib/utils"

type AffiliatePage = "overview" | "links" | "conversions" | "commissions" | "payouts" | "settings"

/**
 * The affiliate portal's frame. Same shell as the dashboard, so a founder who
 * is also an affiliate never learns two products; on a phone it is an app bar
 * and a drawer, which is where affiliates check their earnings.
 */
export function AffiliateShell({
  email,
  name,
  hasWorkspace = false,
  children,
}: {
  email: string
  name?: string | null
  /** Whether this person also belongs to a workspace, so the dashboard link is real. */
  hasWorkspace?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("nav")
  const tp = useTranslations("palette")
  const router = useRouter()

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

  const shared = useShellCommands({ portal: hasWorkspace ? "dashboard" : null })
  // Navigation to links, commissions and payouts comes from the nav items; the
  // one portal action is the one affiliates come back for.
  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "new-link",
        group: "actions",
        label: tp("newLink"),
        icon: Plus,
        keywords: "link criar create",
        run: () => router.push("/affiliate/links"),
      },
      ...shared,
    ],
    [tp, router, shared],
  )

  return (
    <AppShell
      brand={
        <Link
          href="/affiliate/overview"
          aria-label={t("portalHome")}
          className={cn("flex h-8 items-center rounded-control px-1.5", SIDEBAR_CENTER_IN_RAIL)}
        >
          <Logo labelClassName={SIDEBAR_LABEL} />
        </Link>
      }
      sections={sections}
      footer={footer}
      account={<AccountMenu email={email} name={name} portal={hasWorkspace ? "dashboard" : null} />}
      commands={commands}
    >
      {children}
    </AppShell>
  )
}
