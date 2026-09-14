import { BarChart3, Coins, CreditCard, Link2, Receipt, Settings } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Logo } from "@/components/layout/logo"
import { TopBar } from "@/components/layout/top-bar"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

import { AffiliateNav } from "./nav"

export const dynamic = "force-dynamic"

const NAV = [
  { href: "/affiliate/overview", label: "Overview", icon: BarChart3 },
  { href: "/affiliate/links", label: "Links", icon: Link2 },
  { href: "/affiliate/conversions", label: "Conversions", icon: Receipt },
  { href: "/affiliate/commissions", label: "Commissions", icon: Coins },
  { href: "/affiliate/payouts", label: "Payouts", icon: CreditCard },
  { href: "/affiliate/settings", label: "Settings", icon: Settings },
]

/**
 * Mobile-first by design (spec §41): affiliates check their earnings on a
 * phone, so navigation is a horizontal rail at the top rather than a sidebar.
 */
export default async function AffiliateLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser()

  const participations = await withUser(user.id, (tx) =>
    listParticipationsForUser(tx, user.id),
  )
  if (participations.length === 0) redirect("/app")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar email={user.email} affiliatePortal>
        <Link href="/affiliate/overview" aria-label="Affiliate portal home">
          <Logo />
        </Link>
      </TopBar>

      <AffiliateNav items={NAV.map(({ href, label }) => ({ href, label }))} />

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
