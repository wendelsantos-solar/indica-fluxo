import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"

import { clientMessages } from "@/i18n/client-messages"
import { redirect } from "@/i18n/navigation"

import { AffiliateShell } from "@/components/layout/affiliate-shell"
import { requireUser } from "@/server/auth/session"
import { listUserWorkspaces } from "@/server/services/workspaces"
import { withUser } from "@/server/db"
import { userHasParticipation } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

/**
 * Mobile-first by design (spec §41): affiliates check their earnings on a
 * phone, where the shell is an app bar and a drawer; the pages themselves
 * render lists as cards below `md`.
 */
export default async function AffiliateLayout({ children }: LayoutProps<"/[locale]">) {
  const user = await requireUser()

  // The account menu only offers the founder dashboard to someone with a workspace.
  const [isAffiliate, workspaces] = await Promise.all([
    withUser(user.id, (tx) => userHasParticipation(tx, user.id)),
    listUserWorkspaces(user.id),
  ])
  if (!isAffiliate) redirect({ href: "/app", locale: await getLocale() })

  return (
    <NextIntlClientProvider messages={await clientMessages("app")}>
      <AffiliateShell email={user.email} name={user.name} hasWorkspace={workspaces.length > 0}>
        {children}
      </AffiliateShell>
    </NextIntlClientProvider>
  )
}
