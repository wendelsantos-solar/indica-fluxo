import { CONNECTORS } from "@/lib/billing/catalog"
import type { Locale } from "@/i18n/routing"

import type { DocsNavGroup } from "./docs-nav"
import { BETA_PROVIDER_ANCHORS, DOCS_GROUPS } from "./structure"
import { BETA_CONNECTORS } from "./universal"

type Translate = (key: string) => string

/**
 * The docs sidebar, for the guide and for the beta page. On the guide every
 * section is an anchor and the beta methods link out; on the beta page it is
 * the other way round. One builder, so both sidebars list the same things.
 */
export function docsNavGroups({
  t,
  locale,
  page,
  guidePath,
  betaPath,
}: {
  t: Translate
  locale: Locale
  page: "guide" | "beta"
  guidePath: string
  betaPath: string
}): DocsNavGroup[] {
  return DOCS_GROUPS.map((group) => {
    const items: DocsNavGroup["items"] = group.sections.map((section) => ({
      id: section.anchors[locale],
      label: t(`nav.sections.${section.key}`),
      ...(page === "beta" ? { href: `${guidePath}#${section.anchors[locale]}` } : {}),
    }))
    if (group.key === "payments") {
      const at = items.findIndex((item) => item.id === DOCS_GROUPS.find((g) => g.key === "payments")!.sections[1]!.anchors[locale])
      const beta = BETA_CONNECTORS.map((id) => ({
        id: `beta-${BETA_PROVIDER_ANCHORS[id]}`,
        label: CONNECTORS[id].name,
        badge: t("nav.beta"),
        href: page === "beta" ? `#${BETA_PROVIDER_ANCHORS[id]}` : `${betaPath}#${BETA_PROVIDER_ANCHORS[id]}`,
      }))
      items.splice(at + 1, 0, ...beta)
    }
    return { key: group.key, label: t(`nav.groups.${group.key}`), items }
  })
}
