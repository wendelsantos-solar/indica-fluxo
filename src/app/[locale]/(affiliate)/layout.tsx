import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

import { AffiliateShell } from "@/components/layout/affiliate-shell"
import { requireUser } from "@/server/auth/session"
import { listUserWorkspaces } from "@/server/services/workspaces"
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

  // The account menu only offers the founder dashboard to someone with a workspace.
  const workspaces = await listUserWorkspaces(user.id)

  return (
    <AffiliateShell email={user.email} name={user.name} hasWorkspace={workspaces.length > 0}>
      {children}
    </AffiliateShell>
  )
}
