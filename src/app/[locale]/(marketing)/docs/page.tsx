import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/docs">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs" })
  return { title: t("metaTitle") }
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
    <div className="mx-auto w-full max-w-reading px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-heading-sm font-medium sm:text-heading">{t("title")}</h1>
      <p className="mt-4 text-body-sm leading-relaxed text-muted-foreground">
        {t("subtitle")}
      </p>

      <div className="mt-12 space-y-10">
        {SECTIONS.map((key, index) => (
          <section key={key}>
            <h2 className="text-body-lg font-medium tracking-tight">
              {index + 1} — {t(`sections.${key}.title`)}
            </h2>
            <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
              {t(`sections.${key}.body`)}
            </p>
            <pre
              data-slot="scrollable"
              className="mt-4 overflow-x-auto rounded-panel border border-border bg-surface-1 p-4 font-mono text-meta leading-relaxed text-foreground-secondary"
            >
              <code>{SNIPPETS[key]}</code>
            </pre>
          </section>
        ))}
      </div>
    </div>
  )
}
