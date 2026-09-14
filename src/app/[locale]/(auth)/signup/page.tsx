import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { AuthForm } from "@/features/auth/auth-form"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "auth" })
  return { title: t("signup.title") }
}

export default async function SignupPage({ params }: PageProps<"/[locale]/signup">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <AuthForm mode="signup" />
}
