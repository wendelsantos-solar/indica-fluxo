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
  UserPlus,
  Users,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import * as React from "react"

import { usePathname, useRouter } from "@/i18n/navigation"

import { AccountMenu } from "@/components/layout/account-menu"
import { AppShell, type NavItem, type NavSection } from "@/components/layout/app-shell"
import type { Command, PaletteSearch } from "@/components/layout/command-palette"
import { EnvironmentControl, EnvironmentStrip, type ShellEnvironment } from "@/components/layout/environment-switch"
import { useShellCommands } from "@/components/layout/shell-commands"
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher"
import { formatBatchLabel } from "@/features/payouts/batch-label"
import { searchWorkspaceAction } from "@/features/search/actions"
import { LAST_WORKSPACE_COOKIE, LAST_WORKSPACE_MAX_AGE_SECONDS } from "@/lib/last-workspace"

type DashboardPage =
  | "overview"
  | "programs"
  | "affiliates"
  | "conversions"
  | "commissions"
  | "payouts"
  | "integrations"
  | "settings"

const BATCH_STATUSES = ["draft", "approved", "paid", "cancelled"] as const

/**
 * Onboarding's program step (`programs/new?onboarding=1`) shares step 1's bare
 * frame: a founder half-way through setup is not shown eight places to go.
 * A layout cannot read search params, so the shell decides on the client.
 */
function useOnboardingFocus(): boolean {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return pathname === "/[workspaceSlug]/programs/new" && searchParams.get("onboarding") === "1"
}

/** The founder dashboard's frame. Navigation mirrors the money: grow, then settle. */
export function DashboardShell({
  workspaces,
  current,
  email,
  name,
  isAffiliate = false,
  environment,
  notice,
  children,
}: {
  workspaces: WorkspaceOption[]
  current: WorkspaceOption
  email: string
  name?: string | null
  /** Which data the dashboard shows — docs/PLANS.md §2. Resolved on the server. */
  environment: ShellEnvironment
  /** Workspace-wide notice above every page (the billing banner), rendered on the server. */
  notice?: React.ReactNode
  /** Whether this person also participates in a program, so the portal link is real. */
  isAffiliate?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("nav")
  const tp = useTranslations("palette")
  const tb = useTranslations("dashboard.payouts.batchStatus")
  const te = useTranslations("common.environment")
  const locale = useLocale()
  const router = useRouter()
  const slug = current.slug
  const focus = useOnboardingFocus()

  // Remembered for "Voltar ao painel" on the onboarding screen.
  React.useEffect(() => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${LAST_WORKSPACE_MAX_AGE_SECONDS}; samesite=lax`
  }, [slug])

  const { sections, footer } = React.useMemo(() => {
    const item = (key: DashboardPage, icon: NavItem["icon"], chord: string): NavItem => ({
      key,
      label: t(key),
      href: { pathname: `/[workspaceSlug]/${key}`, params: { workspaceSlug: slug } },
      // `usePathname` from `@/i18n/navigation` returns the route template
      // (`/[workspaceSlug]/programs`), not the resolved URL.
      path: `/[workspaceSlug]/${key}`,
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
      {
        id: "invite-affiliate",
        group: "actions",
        label: tp("inviteAffiliate"),
        icon: UserPlus,
        keywords: "invite convidar affiliate afiliado",
        // The affiliates page opens its invite dialog for `?invite=1`.
        run: () =>
          router.push({
            pathname: "/[workspaceSlug]/affiliates",
            params: { workspaceSlug: slug },
            query: { invite: "1" },
          }),
      },
      {
        id: "new-batch",
        group: "actions",
        label: tp("newBatch"),
        icon: CreditCard,
        keywords: "batch lote payout pagamento",
        run: () => router.push({ pathname: "/[workspaceSlug]/payouts", params: { workspaceSlug: slug } }),
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

  const search = React.useCallback<PaletteSearch>(
    async (query) => {
      const found = await searchWorkspaceAction({ workspaceSlug: slug, query })
      return [
        ...found.programs.map<Command>((program) => ({
          id: `program-${program.id}`,
          group: "programs",
          label: program.name,
          // Search finds both environments; a test record says so.
          detail: program.environment === "test" ? te("test") : undefined,
          icon: Layers,
          run: () =>
            router.push({
              pathname: "/[workspaceSlug]/programs/[programSlug]",
              params: { workspaceSlug: slug, programSlug: program.slug },
            }),
        })),
        ...found.affiliates.map<Command>((affiliate) => ({
          id: `affiliate-${affiliate.id}`,
          group: "affiliates",
          label: affiliate.name,
          icon: Users,
          run: () =>
            router.push({
              pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
              params: { workspaceSlug: slug, affiliateId: affiliate.id },
            }),
        })),
        ...found.batches.map<Command>((batch) => ({
          id: `batch-${batch.id}`,
          group: "batches",
          // The stored reference is English ledger data; the reader sees the month in their language.
          label: formatBatchLabel(locale, new Date(batch.periodEnd), batch.reference),
          keywords: batch.reference,
          detail: [
            batch.environment === "test" ? te("test") : null,
            (BATCH_STATUSES as readonly string[]).includes(batch.status) ? tb(batch.status) : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
          icon: CreditCard,
          run: () =>
            router.push({
              pathname: "/[workspaceSlug]/payouts/[batchId]",
              params: { workspaceSlug: slug, batchId: batch.id },
            }),
        })),
      ]
    },
    [slug, router, tb, te, locale],
  )

  return (
    <AppShell
      brand={<WorkspaceSwitcher workspaces={workspaces} current={current} />}
      sections={sections}
      footer={footer}
      account={<AccountMenu email={email} name={name} portal={isAffiliate ? "affiliate" : null} />}
      environment={<EnvironmentControl workspaceSlug={slug} {...environment} />}
      banner={
        <>
          <EnvironmentStrip workspaceSlug={slug} {...environment} />
          {notice}
        </>
      }
      commands={commands}
      search={search}
      focus={focus}
    >
      {children}
    </AppShell>
  )
}
