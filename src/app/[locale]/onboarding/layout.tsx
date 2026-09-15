import { NextIntlClientProvider } from "next-intl"

import { clientMessages } from "@/i18n/client-messages"

/** Onboarding's client components (the workspace form, the stepper) read the app scope's messages. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages("app")}>{children}</NextIntlClientProvider>
}
