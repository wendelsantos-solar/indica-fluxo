import { NextIntlClientProvider } from "next-intl"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"

import { clientMessages } from "@/i18n/client-messages"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"

import { Logo } from "@/components/layout/logo"
import { DocsHeader } from "@/features/docs/docs-header"
import { DOCS_GROUPS } from "@/features/docs/structure"

/**
 * The documentation frame: a docs bar (not the marketing navbar), the page,
 * and a compact footer. No session is read, so docs stay statically rendered.
 */
export default async function DocsLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("docs")
  const current = (await getLocale()) as Locale

  const groups = DOCS_GROUPS.map((group) => ({
    key: group.key,
    label: t(`nav.groups.${group.key}`),
    items: group.sections.map((section) => ({
      id: section.anchors[current],
      label: t(`nav.sections.${section.key}`),
      step: section.step,
    })),
  }))

  const link = "text-meta text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"

  return (
    <NextIntlClientProvider messages={await clientMessages("docs")}>
      <div className="flex min-h-dvh flex-col bg-background">
        <DocsHeader groups={groups} />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-docs flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 sm:px-6">
            <Logo compact />
            <p className="text-meta text-faint-foreground">{t("footer.rights", { year: new Date().getFullYear() })}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
              <Link href="/" className={link}>
                {t("footer.home")}
              </Link>
              <Link href="/pricing" className={link}>
                {t("footer.pricing")}
              </Link>
              <Link href="/app" className={link}>
                {t("footer.dashboard")}
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </NextIntlClientProvider>
  )
}
