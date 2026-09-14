import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

export default async function WorkspaceIndex({ params }: PageProps<"/[locale]/[workspaceSlug]">) {
  const { workspaceSlug } = await params
  redirect({
    href: { pathname: "/[workspaceSlug]/overview", params: { workspaceSlug } },
    locale: await getLocale(),
  })
}
