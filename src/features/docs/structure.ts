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
  | "quickstart"
  | "howItWorks"
  | "customerFirst"
  | "guestCheckout"
  | "multipleProviders"
  | "multipleAccounts"
  | "betaProviders"
  | "identityConcepts"
  | "checkoutBridge"
  | "missingCommission"
  | "providerCredentials"
  | "installTracker"
  | "checkoutMethods"
  | "identifyCustomer"
  | "connectStripe"
  | "commission"
  | "refunds"
  | "verify"
  | "integrationHealth"
  | "attribution"
  | "holdPeriod"
  | "environments"
  | "apiKeys"
  | "webhookSecurity"
  | "identifyApi"
  | "webhookEvents"
  | "errors"

export type DocsSubsectionKey =
  | "prerequisites"
  | "trackerDetails"
  | "stripeManual"
  | "checkoutHosted"
  | "checkoutLinks"
  | "checkoutCustom"
  | "checkoutSubscriptions"
  | "visitorId"
  | "identifyFields"
  | "identifyResponse"
  | "goLive"
  | "commissionLifecycle"
  | "attributionWindow"
  | "firstClick"
  | "lastClick"
  | "programPause"
  | "advancedDiagnostics"

type Anchors = Record<Locale, string>

export interface DocsSection {
  key: DocsSectionKey
  anchors: Anchors
  children?: { key: DocsSubsectionKey; anchors: Anchors }[]
}

export type DocsGroupKey = "start" | "universal" | "payments" | "concepts" | "api" | "diagnostics" | "security"

/**
 * The reading order is the integration order (brief §45, §66): install,
 * identify, connect billing, test, go live — then concepts and reference.
 * Anchors never change when a section moves, so links already shared keep
 * landing on the same text (`antes-de-comecar` is now a part of the quickstart).
 */
export const DOCS_GROUPS: { key: DocsGroupKey; sections: DocsSection[] }[] = [
  {
    key: "start",
    sections: [
      { key: "introduction", anchors: { "pt-br": "introducao", en: "introduction" } },
      {
        key: "quickstart",
        anchors: { "pt-br": "guia-rapido", en: "quickstart" },
        children: [{ key: "prerequisites", anchors: { "pt-br": "antes-de-comecar", en: "before-you-start" } }],
      },
      { key: "howItWorks", anchors: { "pt-br": "como-funciona", en: "how-it-works" } },
    ],
  },
  {
    key: "universal",
    sections: [
      {
        key: "installTracker",
        anchors: { "pt-br": "instalar-tracker", en: "install-tracker" },
        children: [{ key: "trackerDetails", anchors: { "pt-br": "o-que-o-tracker-faz", en: "what-the-tracker-does" } }],
      },
      {
        key: "identifyCustomer",
        anchors: { "pt-br": "identificar-cliente", en: "identify-customer" },
        children: [
          { key: "visitorId", anchors: { "pt-br": "visitor-id", en: "visitor-id" } },
          { key: "identifyFields", anchors: { "pt-br": "campos", en: "fields" } },
          { key: "identifyResponse", anchors: { "pt-br": "resposta", en: "response" } },
        ],
      },
      { key: "customerFirst", anchors: { "pt-br": "customer-first", en: "customer-first" } },
      { key: "guestCheckout", anchors: { "pt-br": "guest-checkout", en: "guest-checkout" } },
    ],
  },
  {
    key: "payments",
    sections: [
      {
        key: "connectStripe",
        anchors: { "pt-br": "configurar-stripe", en: "set-up-stripe" },
        children: [{ key: "stripeManual", anchors: { "pt-br": "stripe-manual", en: "stripe-manual" } }],
      },
      {
        key: "checkoutMethods",
        anchors: { "pt-br": "como-voce-cobra", en: "how-you-charge" },
        children: [
          { key: "checkoutHosted", anchors: { "pt-br": "stripe-checkout", en: "stripe-checkout" } },
          { key: "checkoutLinks", anchors: { "pt-br": "payment-links", en: "payment-links" } },
          { key: "checkoutCustom", anchors: { "pt-br": "checkout-proprio", en: "custom-checkout" } },
          { key: "checkoutSubscriptions", anchors: { "pt-br": "api-de-assinaturas", en: "subscriptions-api" } },
        ],
      },
      { key: "multipleProviders", anchors: { "pt-br": "varios-meios-de-pagamento", en: "multiple-payment-methods" } },
      { key: "multipleAccounts", anchors: { "pt-br": "varias-contas", en: "multiple-accounts" } },
      { key: "betaProviders", anchors: { "pt-br": "meios-em-beta", en: "beta-payment-methods" } },
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
          { key: "programPause", anchors: { "pt-br": "programa-pausado", en: "paused-program" } },
        ],
      },
      { key: "identityConcepts", anchors: { "pt-br": "identidade-do-cliente", en: "customer-identity" } },
      {
        key: "commission",
        anchors: { "pt-br": "comissao", en: "commission" },
        children: [{ key: "commissionLifecycle", anchors: { "pt-br": "ciclo-da-comissao", en: "commission-lifecycle" } }],
      },
      { key: "refunds", anchors: { "pt-br": "reembolsos", en: "refunds" } },
      { key: "holdPeriod", anchors: { "pt-br": "retencao", en: "hold-period" } },
    ],
  },
  {
    key: "api",
    sections: [
      { key: "identifyApi", anchors: { "pt-br": "api-identify", en: "identify-api" } },
      { key: "checkoutBridge", anchors: { "pt-br": "checkout-bridge", en: "checkout-bridge" } },
      { key: "webhookEvents", anchors: { "pt-br": "eventos-stripe", en: "stripe-events" } },
      { key: "errors", anchors: { "pt-br": "erros", en: "errors" } },
    ],
  },
  {
    key: "diagnostics",
    sections: [
      { key: "verify", anchors: { "pt-br": "validar", en: "verify" } },
      {
        key: "integrationHealth",
        anchors: { "pt-br": "saude-da-integracao", en: "integration-health" },
        children: [{ key: "advancedDiagnostics", anchors: { "pt-br": "diagnostico-avancado", en: "advanced-diagnostics" } }],
      },
      { key: "missingCommission", anchors: { "pt-br": "pagamento-sem-comissao", en: "payment-without-commission" } },
    ],
  },
  {
    key: "security",
    sections: [
      { key: "providerCredentials", anchors: { "pt-br": "credenciais-dos-meios-de-pagamento", en: "payment-method-credentials" } },
      { key: "apiKeys", anchors: { "pt-br": "chaves", en: "api-keys" } },
      { key: "webhookSecurity", anchors: { "pt-br": "seguranca-dos-webhooks", en: "webhook-security" } },
      {
        key: "environments",
        anchors: { "pt-br": "teste-e-producao", en: "test-and-live" },
        children: [{ key: "goLive", anchors: { "pt-br": "ir-para-producao", en: "go-live" } }],
      },
    ],
  },
]

/** The beta payment methods, documented on their own page (`/docs/beta`, not indexed). */
export const BETA_PROVIDER_ANCHORS = {
  mercado_pago: "mercado-pago",
  abacatepay: "abacatepay",
  asaas: "asaas",
} as const

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
