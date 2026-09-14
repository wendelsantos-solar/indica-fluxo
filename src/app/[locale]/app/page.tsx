import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { withUser } from "@/server/db"
import { requireUser } from "@/server/auth/session"
import { listUserWorkspaces } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

/**
 * The post-login fork. A founder lands in their workspace, an affiliate in
 * their portal, and anyone with neither goes through onboarding.
 */
export default async function AppEntryPage() {
  const locale = await getLocale()
  const user = await requireUser()

  const workspaces = await listUserWorkspaces(user.id)
  if (workspaces.length > 0) {
    redirect({
      href: {
        pathname: "/[workspaceSlug]/overview",
        params: { workspaceSlug: workspaces[0]!.slug },
      },
      locale,
    })
  }

  const participations = await withUser(user.id, (tx) => listParticipationsForUser(tx, user.id))
  if (participations.length > 0) redirect({ href: "/affiliate/overview", locale })

  redirect({ href: "/onboarding", locale })
}
