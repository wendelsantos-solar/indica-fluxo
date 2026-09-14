import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

import { AffiliateShell } from "@/components/layout/affiliate-shell"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

/**
 * Mobile-first by design (spec §41): affiliates check their earnings on a
 * phone, where the shell is an app bar and a drawer; the pages themselves
 * render lists as cards below `md`.
 */
export default async function AffiliateLayout({ children }: LayoutProps<"/[locale]">) {
  const user = await requireUser()

  const participations = await withUser(user.id, (tx) =>
    listParticipationsForUser(tx, user.id),
  )
  if (participations.length === 0) redirect({ href: "/app", locale: await getLocale() })

  return <AffiliateShell email={user.email}>{children}</AffiliateShell>
}
