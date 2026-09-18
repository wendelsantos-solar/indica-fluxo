import { ArrowUpRight } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"
import type * as React from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { StatusDot } from "@/components/ui/badge"
import { CodeTabs } from "@/features/docs/code-tabs"
import { identifyCurl, identifyTypeScript, TRACKER_FACTS } from "@/features/docs/snippets"
import { sectionAnchor } from "@/features/docs/structure"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"

const code = (chunks: React.ReactNode) => <code className="font-mono text-meta">{chunks}</code>
const strong = (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>

/**
 * The step that ties a click to a paying customer. Without it a Stripe payment
 * is recorded but earns no commission, so it sits on Integrations with the
 * real app URL — not only in the guide. The samples are the guide's own.
 */
export async function IdentifySection({
  appOrigin,
  lastIdentified,
}: {
  appOrigin: string
  /** Pre-formatted per mode ("há 2 horas"), `null` when nothing was identified yet. */
  lastIdentified: Record<"test" | "live", string | null>
}) {
  const t = await getTranslations("dashboard.integrations.identify")
  const docs = await getTranslations("docs")
  const locale = (await getLocale()) as Locale

  return (
    <section id="identify" className="scroll-mt-16 space-y-4">
      <SectionHeader title={t("title")} description={t.rich("description", { code })} className="mb-0" />

      <ul className="space-y-1">
        {(["test", "live"] as const).map((environment) => {
          const when = lastIdentified[environment]
          return (
            <li key={environment} className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <StatusDot tone={when ? "success" : "neutral"} />
              {when ? t("lastIdentify", { environment, when }) : t("noIdentify", { environment })}
            </li>
          )
        })}
      </ul>

      <InlineAlert tone="danger" title={docs("identifyCustomer.securityTitle")}>
        {docs.rich("identifyCustomer.securityBody", { code, strong })}
      </InlineAlert>

      <CodeTabs
        label={docs("code.samples")}
        copyLabel={docs("code.copy")}
        samples={[
          { id: "typescript", title: "TypeScript", language: "typescript", code: identifyTypeScript(appOrigin) },
          { id: "curl", title: "cURL", language: "bash", code: identifyCurl(appOrigin) },
        ]}
      />

      <dl className="space-y-3">
        <div>
          <dt className="text-caption font-medium text-foreground">{t("visitorTitle")}</dt>
          <dd className="mt-1 max-w-prose text-meta text-muted-foreground">
            {t.rich("visitorBody", { code, cookie: TRACKER_FACTS.cookie })}
          </dd>
        </div>
        <div>
          <dt className="text-caption font-medium text-foreground">{docs("identifyCustomer.stripeIdTitle")}</dt>
          <dd className="mt-1 max-w-prose text-meta text-muted-foreground">
            {docs.rich("identifyCustomer.stripeIdBody", { code, strong })}
          </dd>
        </div>
      </dl>

      <Link
        href={{ pathname: "/docs", hash: sectionAnchor("identifyCustomer", locale) }}
        className="inline-flex items-center gap-1 text-caption text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("guide")}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </section>
  )
}
