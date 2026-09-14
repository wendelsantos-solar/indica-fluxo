import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { ResetLinkExpired, ResetPasswordForm } from "@/features/auth/reset-password-form"
import { createClient } from "@/lib/supabase/server"

// Depends on the session cookie the callback just set; never cache it.
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "auth" })
  return { title: t("reset.title") }
}

/**
 * Reached from the recovery e-mail through `/auth/callback`, which trades the
 * link's code for a session. No session means the link expired, was already
 * used, or was opened in another browser — the page says so and offers a new
 * link instead of bouncing to sign-in.
 */
export default async function ResetPasswordPage({
  params,
}: PageProps<"/[locale]/reset-password">) {
  const { locale } = await params
  setRequestLocale(locale)

  // Asks Supabase directly rather than the app's session helper: the only
  // thing that matters here is whether `updateUser` will have a session.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return <ResetLinkExpired />

  return <ResetPasswordForm email={user.email} />
}
