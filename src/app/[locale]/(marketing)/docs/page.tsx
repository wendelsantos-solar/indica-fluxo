import type { Metadata } from "next"

import { getPathname } from "@/i18n/navigation"
import { localeAlternates } from "@/lib/site"
import { getTranslations, setRequestLocale } from "next-intl/server"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/docs">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs" })
  const { canonical, languages } = localeAlternates("/docs", locale, (target) =>
    getPathname({ href: "/docs", locale: target }),
  )
  return { title: t("metaTitle"), alternates: { canonical, languages } }
}

/**
 * Prose is translated; the code samples are not. A curl invocation, a header
 * name and a JSON key are the API's own vocabulary — translating them would
 * produce a snippet that does not run.
 */
const SNIPPETS = {
  install: `<script defer
  src="https://app.example.com/t.js"
  data-key="pk_live_xxxxxxxx"></script>`,
  identify: `curl -X POST https://app.example.com/api/identify \\
  -H "Authorization: Bearer sk_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "visitorId": "v_ab12cd34ef56gh78",
    "externalId": "user_4821",
    "providerCustomerId": "cus_QX1y2Z"
  }'`,
  webhook: `https://app.example.com/api/webhooks/stripe`,
  commission: `base   4900  (minor units)
rate   3000  (basis points = 30%)
────────────────────────────────
result 1470`,
} as const

const SECTIONS = ["install", "identify", "webhook", "commission"] as const

export default async function DocsPage({ params }: PageProps<"/[locale]/docs">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("docs")

  return (
    <div className="mx-auto w-full max-w-reading px-4 py-24 sm:px-6 sm:py-32">
      <h1 className="text-balance text-heading-sm text-foreground sm:text-heading">{t("title")}</h1>
      <p className="mt-6 text-pretty text-body text-muted-foreground">{t("subtitle")}</p>

      <ol className="mt-16 sm:mt-20">
        {SECTIONS.map((key, index) => (
          <li key={key} className="border-t border-border py-10 last:pb-0">
            <section aria-labelledby={`docs-${key}`}>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-meta text-faint-foreground" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 id={`docs-${key}`} className="text-title text-foreground">
                  {t(`sections.${key}.title`)}
                </h2>
              </div>
              <p className="mt-3 text-pretty text-body-sm text-muted-foreground">
                {/* Raw, not formatted: the prose quotes code (`</head>`), which
                    ICU would parse as an unmatched rich-text tag and throw.
                    These bodies take no arguments, so nothing is lost. */}
                {t.raw(`sections.${key}.body`) as string}
              </p>
              <pre
                data-slot="scrollable"
                className="mt-5 overflow-x-auto rounded-panel border border-border bg-surface-1 p-4 font-mono text-meta leading-relaxed text-foreground-secondary"
              >
                <code>{SNIPPETS[key]}</code>
              </pre>
            </section>
          </li>
        ))}
      </ol>
    </div>
  )
}
