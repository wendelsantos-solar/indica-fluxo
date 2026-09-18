import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import * as React from "react"

import { Callout } from "@/features/docs/callout"
import { CodeBlock } from "@/features/docs/code-block"
import { DocsSidebarNav } from "@/features/docs/docs-nav"
import { InlineCode } from "@/features/docs/inline-code"
import { docsNavGroups } from "@/features/docs/nav"
import { SectionHeading } from "@/features/docs/section-heading"
import { StatusPill } from "@/features/docs/status-pill"
import { BETA_PROVIDER_ANCHORS } from "@/features/docs/structure"
import { BETA_CONNECTORS } from "@/features/docs/universal"
import { checkoutBridgeSnippet } from "@/features/integrations/bridge-snippets"
import { Link, getPathname } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { ABACATEPAY_EVENTS } from "@/lib/billing/abacatepay/connector"
import { ASAAS_EVENTS } from "@/lib/billing/asaas/connector"
import { CONNECTORS } from "@/lib/billing/catalog"
import { BRAND } from "@/lib/brand"
import { MERCADO_PAGO_TOPICS } from "@/lib/billing/mercado-pago/connector"

/**
 * The beta payment methods, one short page each (brief §39): what connecting
 * takes, what the product sets up by itself, what the founder must do, and the
 * known limits — from the connectors' own constants where there is one.
 *
 * Deliberately NOT in `src/lib/seo/pages.ts`: it inherits the root `noindex`.
 * A beta method is documented for the founders who use it, never sold on a
 * search page before it is production-ready (SEO_CONTENT_MAP.md backlog).
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/docs/beta">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs.beta" })
  return { title: t("metaTitle") }
}

const EVENTS: Record<(typeof BETA_CONNECTORS)[number], readonly string[]> = {
  mercado_pago: MERCADO_PAGO_TOPICS,
  abacatepay: ABACATEPAY_EVENTS,
  asaas: ASAAS_EVENTS,
}

/** Same order as Stripe's page in the guide (brief §33): what you do, what the product does, what works, what does not, how to test. */
const ROWS = ["status", "connect", "you", "automatic", "methods", "events", "refunds", "subscriptions", "environment", "limits", "test"] as const

const textLink = "text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"

export default async function BetaProvidersPage({ params }: PageProps<"/[locale]/docs/beta">) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations("docs")
  const current = (await getLocale()) as Locale
  const rich = {
    code: (chunks: React.ReactNode) => <InlineCode>{chunks}</InlineCode>,
    strong: (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>,
  }

  const guidePath = getPathname({ href: "/docs", locale: current })
  const groups = docsNavGroups({
    t,
    locale: current,
    page: "beta",
    guidePath,
    betaPath: getPathname({ href: "/docs/beta", locale: current }),
  })

  return (
    <div className="mx-auto grid w-full max-w-docs gap-10 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:pt-10 xl:gap-12">
      <aside className="hidden lg:block">
        <div data-slot="scrollable" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6 pr-4">
          <DocsSidebarNav groups={groups} label={t("nav.label")} />
        </div>
      </aside>

      <main id="main" className="min-w-0">
        <article className="mx-auto max-w-detail space-y-10">
          <header className="space-y-4">
            <nav aria-label={t("breadcrumb.label")} className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <Link href="/docs" className="hover:text-foreground">
                {t("breadcrumb.docs")}
              </Link>
              <span aria-hidden="true" className="text-faint-foreground">
                /
              </span>
              <span aria-current="page" className="text-foreground-secondary">
                {t("beta.breadcrumb")}
              </span>
            </nav>
            <h1 className="flex flex-wrap items-center gap-3 text-balance text-heading-sm text-foreground">
              {t("beta.title")}
              <StatusPill tone="beta">{t("nav.beta")}</StatusPill>
            </h1>
            <p className="max-w-reading text-pretty text-body text-muted-foreground">{t("beta.lead")}</p>
            <Callout tone="warning" title={t("beta.meaningTitle")}>
              {t("beta.meaning")}
            </Callout>
            <p className="max-w-reading text-caption text-foreground-secondary">{t("beta.notComingSoon")}</p>
          </header>

          {BETA_CONNECTORS.map((id) => (
            <section key={id} className="space-y-4 border-t border-border-faint pt-10">
              <SectionHeading
                id={BETA_PROVIDER_ANCHORS[id]}
                level={2}
                badge={<StatusPill tone="beta">{t("nav.beta")}</StatusPill>}
              >
                {CONNECTORS[id].name}
              </SectionHeading>
              <dl className="divide-y divide-border-faint rounded-panel border border-border text-caption">
                {ROWS.map((row) => (
                  <div key={row} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-muted-foreground">{t(`beta.labels.${row}`)}</dt>
                    <dd className="min-w-0 text-foreground-secondary">
                      {row === "status" ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <StatusPill tone="beta">{t("nav.beta")}</StatusPill>
                          {t("beta.statusValue")}
                        </span>
                      ) : row === "events" ? (
                        <span className="flex flex-wrap gap-1.5">
                          {EVENTS[id].map((event) => (
                            <InlineCode key={event} className="whitespace-normal break-all">
                              {event}
                            </InlineCode>
                          ))}
                        </span>
                      ) : (
                        t.rich(`beta.providers.${id}.${row}`, rich)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <CodeBlock code={checkoutBridgeSnippet(id)} language="typescript" title={t("checkoutBridge.title")} />
            </section>
          ))}

          <section className="space-y-4 border-t border-border-faint pt-10">
            <SectionHeading id={t("beta.report.anchor")} level={2}>
              {t("beta.report.title")}
            </SectionHeading>
            <p className="max-w-reading text-body-sm text-foreground-secondary">{t("beta.report.lead")}</p>
            <ul className="max-w-reading list-disc space-y-1.5 pl-5 text-body-sm text-foreground-secondary">
              {(["connection", "event", "reason", "when"] as const).map((key) => (
                <li key={key}>{t.rich(`beta.report.items.${key}`, rich)}</li>
              ))}
            </ul>
            <Callout tone="danger" title={t("beta.report.neverTitle")}>
              {t("beta.report.never")}
            </Callout>
            {BRAND.supportEmail ? (
              <p className="text-caption">
                <a href={`mailto:${BRAND.supportEmail}`} className={textLink}>
                  {BRAND.supportEmail}
                </a>
              </p>
            ) : null}
          </section>

          <p className="border-t border-border-faint pt-8 text-caption">
            <a href={guidePath} className={textLink}>
              {t("beta.back")}
            </a>
          </p>
        </article>
      </main>
    </div>
  )
}
