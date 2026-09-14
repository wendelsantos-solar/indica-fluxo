"use client"

import {
  ChartNoAxesColumn,
  Coins,
  CreditCard,
  Layers,
  Plug,
  Plus,
  Receipt,
  Settings2,
  Users,
} from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { useRouter } from "@/i18n/navigation"

import { AccountMenu } from "@/components/layout/account-menu"
import { AppShell, type NavItem, type NavSection } from "@/components/layout/app-shell"
import type { Command } from "@/components/layout/command-palette"
import { useShellCommands } from "@/components/layout/shell-commands"
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher"

/** The founder dashboard's frame. Navigation mirrors the money: grow, then settle. */
export function DashboardShell({
  workspaces,
  current,
  email,
  name,
  isAffiliate = false,
  children,
}: {
  workspaces: WorkspaceOption[]
  current: WorkspaceOption
  email: string
  name?: string | null
  /** Whether this person also participates in a program, so the portal link is real. */
  isAffiliate?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("nav")
  const tp = useTranslations("palette")
  const router = useRouter()
  const slug = current.slug

  const { sections, footer } = React.useMemo(() => {
    const item = (
      key: "overview" | "programs" | "affiliates" | "conversions" | "commissions" | "payouts" | "integrations" | "settings",
      icon: NavItem["icon"],
      chord: string,
    ): NavItem => ({
      key,
      label: t(key),
      href: { pathname: `/[workspaceSlug]/${key}`, params: { workspaceSlug: slug } },
      path: `/${slug}/${key}`,
      icon,
      chord,
    })
    const sections: NavSection[] = [
      { key: "home", items: [item("overview", ChartNoAxesColumn, "o")] },
      {
        key: "growth",
        label: t("sections.growth"),
        items: [item("programs", Layers, "p"), item("affiliates", Users, "a")],
      },
      {
        key: "ledger",
        label: t("sections.ledger"),
        items: [
          item("conversions", Receipt, "c"),
          item("commissions", Coins, "m"),
          item("payouts", CreditCard, "y"),
        ],
      },
      {
        key: "system",
        label: t("sections.system"),
        items: [item("integrations", Plug, "i")],
      },
    ]
    return { sections, footer: [item("settings", Settings2, "s")] }
  }, [t, slug])

  const shared = useShellCommands({ portal: isAffiliate ? "affiliate" : null })

  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "new-program",
        group: "actions",
        label: tp("newProgram"),
        icon: Plus,
        run: () =>
          router.push({ pathname: "/[workspaceSlug]/programs/new", params: { workspaceSlug: slug } }),
      },
      ...shared,
      ...workspaces
        .filter((workspace) => workspace.id !== current.id)
        .map<Command>((workspace) => ({
          id: `workspace-${workspace.id}`,
          group: "workspaces",
          label: tp("switchWorkspace", { name: workspace.name }),
          icon: Layers,
          run: () =>
            router.push({
              pathname: "/[workspaceSlug]/overview",
              params: { workspaceSlug: workspace.slug },
            }),
        })),
    ],
    [tp, router, slug, shared, workspaces, current.id],
  )

  return (
    <AppShell
      brand={<WorkspaceSwitcher workspaces={workspaces} current={current} />}
      sections={sections}
      footer={footer}
      account={<AccountMenu email={email} name={name} portal={isAffiliate ? "affiliate" : null} />}
      commands={commands}
    >
      {children}
    </AppShell>
  )
}

