import type { Locale } from "@/i18n/routing"

/**
 * The guide's outline: sidebar groups, headings and their anchors. One source
 * for the sidebar, the "on this page" list and the `id`s on the headings, so
 * the three cannot disagree. Anchors are translated like pathnames are
 * (`/pt-br/documentacao#instalar-tracker`, `/en/docs#install-tracker`).
 *
 * Today the guide is one page, so every item is an anchor. When it grows, a
 * group can become a route and its items that page's anchors — the shape
 * already carries the grouping.
 */
export type DocsSectionKey =
  | "introduction"
  | "howItWorks"
  | "prerequisites"
  | "installTracker"
  | "identifyCustomer"
  | "connectStripe"
  | "commission"
  | "verify"
  | "attribution"
  | "holdPeriod"
  | "apiKeys"
  | "identifyApi"
  | "webhookEvents"
  | "errors"

export type DocsSubsectionKey =
  | "trackerDetails"
  | "visitorId"
  | "identifyFields"
  | "commissionLifecycle"
  | "attributionWindow"
  | "firstClick"
  | "lastClick"

type Anchors = Record<Locale, string>

export interface DocsSection {
  key: DocsSectionKey
  anchors: Anchors
  /** Step number in the quickstart, when the section is a step. */
  step?: number
  children?: { key: DocsSubsectionKey; anchors: Anchors }[]
}

export const DOCS_GROUPS: { key: "start" | "quickstart" | "concepts" | "security" | "reference"; sections: DocsSection[] }[] = [
  {
    key: "start",
    sections: [
      { key: "introduction", anchors: { "pt-br": "introducao", en: "introduction" } },
      { key: "howItWorks", anchors: { "pt-br": "como-funciona", en: "how-it-works" } },
      { key: "prerequisites", anchors: { "pt-br": "antes-de-comecar", en: "before-you-start" } },
    ],
  },
  {
    key: "quickstart",
    sections: [
      {
        key: "installTracker",
        step: 1,
        anchors: { "pt-br": "instalar-tracker", en: "install-tracker" },
        children: [{ key: "trackerDetails", anchors: { "pt-br": "o-que-o-tracker-faz", en: "what-the-tracker-does" } }],
      },
      {
        key: "identifyCustomer",
        step: 2,
        anchors: { "pt-br": "identificar-cliente", en: "identify-customer" },
        children: [
          { key: "visitorId", anchors: { "pt-br": "visitor-id", en: "visitor-id" } },
          { key: "identifyFields", anchors: { "pt-br": "campos", en: "fields" } },
        ],
      },
      { key: "connectStripe", step: 3, anchors: { "pt-br": "configurar-stripe", en: "connect-stripe" } },
      {
        key: "commission",
        step: 4,
        anchors: { "pt-br": "comissao", en: "commission" },
        children: [{ key: "commissionLifecycle", anchors: { "pt-br": "ciclo-da-comissao", en: "commission-lifecycle" } }],
      },
      { key: "verify", step: 5, anchors: { "pt-br": "validar", en: "verify" } },
    ],
  },
  {
    key: "concepts",
    sections: [
      {
        key: "attribution",
        anchors: { "pt-br": "atribuicao", en: "attribution" },
        children: [
          { key: "attributionWindow", anchors: { "pt-br": "janela-de-atribuicao", en: "attribution-window" } },
          { key: "firstClick", anchors: { "pt-br": "primeiro-clique", en: "first-click" } },
          { key: "lastClick", anchors: { "pt-br": "ultimo-clique", en: "last-click" } },
        ],
      },
      { key: "holdPeriod", anchors: { "pt-br": "retencao", en: "hold-period" } },
    ],
  },
  {
    key: "security",
    sections: [{ key: "apiKeys", anchors: { "pt-br": "chaves", en: "api-keys" } }],
  },
  {
    key: "reference",
    sections: [
      { key: "identifyApi", anchors: { "pt-br": "api-identify", en: "identify-api" } },
      { key: "webhookEvents", anchors: { "pt-br": "eventos-stripe", en: "stripe-events" } },
      { key: "errors", anchors: { "pt-br": "erros", en: "errors" } },
    ],
  },
]

export function sectionAnchor(key: DocsSectionKey | DocsSubsectionKey, locale: Locale): string {
  for (const group of DOCS_GROUPS) {
    for (const section of group.sections) {
      if (section.key === key) return section.anchors[locale]
      const child = section.children?.find((candidate) => candidate.key === key)
      if (child) return child.anchors[locale]
    }
  }
  throw new Error(`Unknown docs section: ${key}`)
}
