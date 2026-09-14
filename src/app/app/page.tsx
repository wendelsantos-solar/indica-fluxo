import { redirect } from "next/navigation"

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
  const user = await requireUser()

  const workspaces = await listUserWorkspaces(user.id)
  if (workspaces.length > 0) redirect(`/${workspaces[0]!.slug}/overview`)

  const participations = await withUser(user.id, (tx) => listParticipationsForUser(tx, user.id))
  if (participations.length > 0) redirect("/affiliate/overview")

  redirect("/onboarding")
}
