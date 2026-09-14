import { BarChart3, Coins, CreditCard, Link2, Receipt, Settings } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { getLocale, getTranslations } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

import { Logo } from "@/components/layout/logo"
import { TopBar } from "@/components/layout/top-bar"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

import { AffiliateNav } from "./nav"

export const dynamic = "force-dynamic"

const NAV = [
  { href: "/affiliate/overview", key: "overview", icon: BarChart3 },
  { href: "/affiliate/links", key: "links", icon: Link2 },
  { href: "/affiliate/conversions", key: "conversions", icon: Receipt },
  { href: "/affiliate/commissions", key: "commissions", icon: Coins },
  { href: "/affiliate/payouts", key: "payouts", icon: CreditCard },
  { href: "/affiliate/settings", key: "settings", icon: Settings },
] as const

/**
 * Mobile-first by design (spec §41): affiliates check their earnings on a
 * phone, so navigation is a horizontal rail at the top rather than a sidebar.
 */
export default async function AffiliateLayout({ children }: LayoutProps<"/[locale]">) {
  const t = await getTranslations("nav")
  const user = await requireUser()

  const participations = await withUser(user.id, (tx) =>
    listParticipationsForUser(tx, user.id),
  )
  if (participations.length === 0) redirect({ href: "/app", locale: await getLocale() })

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar email={user.email} affiliatePortal>
        <Link href="/affiliate/overview" aria-label={t("portalHome")}>
          <Logo />
        </Link>
      </TopBar>

      <AffiliateNav items={NAV.map(({ href, key }) => ({ href, label: t(key) }))} />

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
