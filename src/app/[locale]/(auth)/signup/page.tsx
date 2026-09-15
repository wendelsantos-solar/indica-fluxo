import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { parseInviteQuery } from "@/features/auth/invite-query"
import { SignUpFlow } from "@/features/auth/sign-up-flow"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "auth" })
  return { title: t("signup.title") }
}

export default async function SignupPage({ params, searchParams }: PageProps<"/[locale]/signup">) {
  const { locale } = await params
  setRequestLocale(locale)
  // An invitation link (`?email=…&invite=1`) locks the e-mail the invite was
  // made for, so the trigger that claims invites matches it.
  const invite = parseInviteQuery(await searchParams)
  return <SignUpFlow invitedEmail={invite.invited ? invite.email : undefined} />
}
