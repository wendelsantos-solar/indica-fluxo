import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { ForgotPasswordForm } from "@/features/auth/forgot-password-form"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "auth" })
  return { title: t("forgot.title") }
}

export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ForgotPasswordForm />
}
