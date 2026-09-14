import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

export default async function AffiliateIndex() {
  redirect({ href: "/affiliate/overview", locale: await getLocale() })
}
