import { getTranslations } from "next-intl/server"

import { SectionHeader } from "@/components/layout/page-header"
import { CodeTabs } from "@/features/docs/code-tabs"
import { CONNECTORS, type ConnectorAvailability, type ConnectorId } from "@/lib/billing/catalog"

import { checkoutBridgeSnippet } from "./bridge-snippets"

/**
 * One API to learn, whatever the provider (brief §9): the reference and your
 * customer id, added to the checkout you already create. The provider tabs only
 * show where the product puts them — generated from `checkoutFields`.
 * Providers still `coming_soon` are left out; beta ones are labelled.
 */
export async function CheckoutBridgeSection({
  availability,
  providers,
}: {
  availability: Record<ConnectorId, ConnectorAvailability>
  /** The providers this workspace uses first, then the rest. */
  providers: ConnectorId[]
}) {
  const t = await getTranslations("dashboard.integrations.bridge")
  const docs = await getTranslations("docs")
  const ordered = [...new Set([...providers, ...(Object.keys(CONNECTORS) as ConnectorId[])])].filter(
    (id) => availability[id] !== "coming_soon",
  )

  return (
    <section id="checkout" className="scroll-mt-16 space-y-4">
      <SectionHeader title={t("title")} description={t("description")} className="mb-0" />
      <ul className="max-w-prose list-disc space-y-1 pl-5 text-caption text-muted-foreground">
        <li>{t("flowA")}</li>
        <li>{t("flowB")}</li>
      </ul>
      <CodeTabs
        label={docs("code.samples")}
        copyLabel={docs("code.copy")}
        samples={ordered.map((id) => ({
          id,
          title: availability[id] === "beta" ? `${CONNECTORS[id].name} (${t("beta")})` : CONNECTORS[id].name,
          language: "typescript",
          code: checkoutBridgeSnippet(id),
        }))}
      />
    </section>
  )
}
