import { defineRouting } from "next-intl/routing"

/**
 * Locale routing.
 *
 * Every locale is prefixed, including the default one: `/pt-br/precos` and
 * `/en/pricing` both exist, and `/precos` does not. An unprefixed default would
 * make the canonical URL of a page depend on which locale it is in, which is
 * exactly the ambiguity that breaks hreflang and sitemaps.
 *
 * Pathnames are localised too. A Brazilian founder should not have to read
 * `/pricing` to find out what a page costs, and search engines index the words
 * in the URL. The mapping below is the single place a route's spelling lives —
 * `Link` and `redirect` from `./navigation` resolve it automatically, so no
 * component ever writes a locale-specific href by hand.
 */
export const routing = defineRouting({
  locales: ["pt-br", "en"],
  defaultLocale: "pt-br",
  localePrefix: "always",

  // Persisted so a returning visitor lands where they left off, rather than
  // being re-negotiated by a browser header they may not control.
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },

  pathnames: {
    "/": "/",

    // Marketing
    "/pricing": { "pt-br": "/precos", en: "/pricing" },
    "/docs": { "pt-br": "/documentacao", en: "/docs" },

    // Auth
    "/login": { "pt-br": "/entrar", en: "/login" },
    "/signup": { "pt-br": "/criar-conta", en: "/signup" },
    "/forgot-password": { "pt-br": "/esqueci-a-senha", en: "/forgot-password" },
    "/reset-password": { "pt-br": "/redefinir-senha", en: "/reset-password" },
    "/onboarding": { "pt-br": "/primeiros-passos", en: "/onboarding" },

    // The post-login fork. Not user-facing for long, but it must not 404.
    "/app": "/app",
    "/logout": { "pt-br": "/sair", en: "/logout" },

    // Affiliate portal
    "/affiliate": { "pt-br": "/afiliado", en: "/affiliate" },
    "/affiliate/overview": { "pt-br": "/afiliado/visao-geral", en: "/affiliate/overview" },
    "/affiliate/links": { "pt-br": "/afiliado/links", en: "/affiliate/links" },
    "/affiliate/conversions": { "pt-br": "/afiliado/conversoes", en: "/affiliate/conversions" },
    "/affiliate/commissions": { "pt-br": "/afiliado/comissoes", en: "/affiliate/commissions" },
    "/affiliate/payouts": { "pt-br": "/afiliado/pagamentos", en: "/affiliate/payouts" },
    "/affiliate/settings": { "pt-br": "/afiliado/configuracoes", en: "/affiliate/settings" },

    // Founder dashboard. `[workspaceSlug]` is tenant data, never translated.
    "/[workspaceSlug]": "/[workspaceSlug]",
    "/[workspaceSlug]/overview": {
      "pt-br": "/[workspaceSlug]/visao-geral",
      en: "/[workspaceSlug]/overview",
    },
    "/[workspaceSlug]/programs": {
      "pt-br": "/[workspaceSlug]/programas",
      en: "/[workspaceSlug]/programs",
    },
    "/[workspaceSlug]/programs/new": {
      "pt-br": "/[workspaceSlug]/programas/novo",
      en: "/[workspaceSlug]/programs/new",
    },
    "/[workspaceSlug]/programs/[programSlug]": {
      "pt-br": "/[workspaceSlug]/programas/[programSlug]",
      en: "/[workspaceSlug]/programs/[programSlug]",
    },
    "/[workspaceSlug]/affiliates": {
      "pt-br": "/[workspaceSlug]/afiliados",
      en: "/[workspaceSlug]/affiliates",
    },
    "/[workspaceSlug]/conversions": {
      "pt-br": "/[workspaceSlug]/conversoes",
      en: "/[workspaceSlug]/conversions",
    },
    "/[workspaceSlug]/commissions": {
      "pt-br": "/[workspaceSlug]/comissoes",
      en: "/[workspaceSlug]/commissions",
    },
    "/[workspaceSlug]/payouts": {
      "pt-br": "/[workspaceSlug]/pagamentos",
      en: "/[workspaceSlug]/payouts",
    },
    "/[workspaceSlug]/payouts/[batchId]": {
      "pt-br": "/[workspaceSlug]/pagamentos/[batchId]",
      en: "/[workspaceSlug]/payouts/[batchId]",
    },
    "/[workspaceSlug]/integrations": {
      "pt-br": "/[workspaceSlug]/integracoes",
      en: "/[workspaceSlug]/integrations",
    },
    "/[workspaceSlug]/settings": {
      "pt-br": "/[workspaceSlug]/configuracoes",
      en: "/[workspaceSlug]/settings",
    },
  },
})

export type Locale = (typeof routing.locales)[number]

/** The BCP 47 tag for `Intl`, `<html lang>` and `hreflang`. */
export const BCP47: Record<Locale, string> = {
  "pt-br": "pt-BR",
  en: "en-US",
}

/** What each locale's speakers are most likely to be paid in. */
export const DEFAULT_CURRENCY: Record<Locale, string> = {
  "pt-br": "BRL",
  en: "USD",
}

export const LOCALE_LABEL: Record<Locale, string> = {
  "pt-br": "Português (Brasil)",
  en: "English",
}
