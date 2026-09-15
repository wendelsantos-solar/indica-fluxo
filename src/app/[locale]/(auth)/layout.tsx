import { NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { clientMessages } from "@/i18n/client-messages"
import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { AuthProof } from "@/features/auth/auth-proof"

/**
 * Every auth screen shares this frame.
 *
 * From 1024px it is a split: the left half stays on the canvas, like the
 * marketing pages it was reached from, and says what the visitor is signing
 * into — one statement and the product itself as the only picture. The right
 * half is the working surface: `surface-1` behind a hairline, the form centred
 * in a narrow column, and nothing else competing with its one amber action.
 *
 * Below 1024px the left half is dropped entirely and the form stands alone on
 * the canvas under a slim bar, as the rest of the public chrome does.
 */
export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Without this the layout's `getTranslations` call opts the whole subtree
  // out of static rendering.
  const { locale } = await params
  setRequestLocale(locale)

  const chrome = await getTranslations("marketing.chrome")
  const t = await getTranslations("auth.layout")

  return (
    <NextIntlClientProvider messages={await clientMessages("auth")}>
      <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
        <aside className="hidden min-h-dvh px-12 lg:flex">
          <div className="mx-auto flex w-full max-w-lg flex-col">
            <div className="flex h-14 items-center">
              <Link href="/" aria-label={chrome("home")} className="rounded-control">
                <Logo />
              </Link>
            </div>

            <div className="flex flex-1 flex-col justify-center py-12">
              <div className="space-y-3">
                <p className="text-balance text-heading-sm text-foreground">{t("statement")}</p>
                <p className="text-pretty text-body-sm text-muted-foreground">{t("line")}</p>
              </div>
              <AuthProof className="mt-10 w-full" />
            </div>

            <p className="py-6 text-meta text-faint-foreground">{chrome("tagline")}</p>
          </div>
        </aside>

        <div className="flex min-h-dvh flex-col lg:border-l lg:border-border lg:bg-surface-1">
          <header className="flex h-14 items-center gap-4 px-4 sm:px-6">
            <Link href="/" aria-label={chrome("home")} className="rounded-control lg:hidden">
              <Logo />
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </header>

          {/* Top-aligned on phones, where centring pushes the form under the
              on-screen keyboard; centred once there is room. */}
          <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-6 sm:py-12">
            <div className="w-full max-w-sm">{children}</div>
          </main>

          {/* Kept in the flow (invisible) from 1024px so both halves have the
              same header and footer heights and centre on one baseline. */}
          <footer className="px-4 py-6 text-center text-meta text-faint-foreground sm:px-6 lg:invisible">
            {chrome("tagline")}
          </footer>
        </div>
      </div>
    </NextIntlClientProvider>
  )
}
