import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { SignInForm } from "@/features/auth/sign-in-form"
import { parseInviteQuery } from "@/features/auth/invite-query"
import { safeRedirectPath } from "@/features/auth/safe-redirect"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "auth" })
  return { title: t("signin.title") }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params
  setRequestLocale(locale)
  const query = await searchParams

  // The proxy sets `next` to the page that asked for a session. An unsafe
  // value is dropped here, and `signIn` checks it again, since the hidden
  // field can be edited like any other.
  const next = safeRedirectPath(first(query.next), "") || undefined

  const invite = parseInviteQuery(query)

  return <SignInForm next={next} linkExpired={first(query.error) === "link"} defaultEmail={invite.email} />
}
