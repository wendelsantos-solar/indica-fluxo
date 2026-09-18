import type { Locale } from "@/i18n/routing"
import { BRAND, brandProfiles } from "@/lib/brand"
import { minorToMajor, minorUnitExponent } from "@/lib/money"
import { PLAN_OFFERS, type PlanCode } from "@/lib/plans"
import { siteUrl } from "@/lib/site"

import { HREFLANG, pageUrl } from "./metadata"

/**
 * schema.org JSON-LD, built only from facts the site states in visible text.
 *
 * Deliberately absent: `AggregateRating` and `Review` (there are no real
 * ratings — inventing them is spam under every search engine's policy), and
 * `FAQPage` (Google shows FAQ rich results only for government and health
 * sites since 2023; the FAQs stay visible on the page, where they help
 * readers, without markup that promises a result it will not get).
 */

type JsonLd = Record<string, unknown>

const CONTEXT = "https://schema.org"

function organizationId(): string {
  return `${siteUrl().origin}/#organization`
}

export function organizationJsonLd(): JsonLd {
  const sameAs = brandProfiles()
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": organizationId(),
    name: BRAND.name,
    url: `${siteUrl().origin}/`,
    logo: `${siteUrl().origin}/icon.svg`,
    ...(BRAND.supportEmail ? { email: BRAND.supportEmail } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  }
}

export function websiteJsonLd(locale: Locale): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: BRAND.name,
    url: pageUrl("/", locale),
    inLanguage: HREFLANG[locale],
    publisher: { "@id": organizationId() },
  }
}

/** A schema.org price: a decimal string in major units, as the offer is published. */
export function schemaPrice(amountMinor: number, currency: string): string {
  return minorToMajor(amountMinor, currency).toFixed(minorUnitExponent(currency))
}

/**
 * The product. `offers` lists exactly the plans the pricing page publishes,
 * with the prices from `PLAN_OFFERS` — the same source the page renders.
 */
export function softwareApplicationJsonLd({
  locale,
  description,
  planNames,
}: {
  locale: Locale
  description: string
  planNames: Partial<Record<PlanCode, string>>
}): JsonLd {
  const offers = (Object.keys(PLAN_OFFERS) as PlanCode[])
    .filter((code) => PLAN_OFFERS[code].public && PLAN_OFFERS[code].priceMonthlyMinor !== null)
    .map((code) => {
      const offer = PLAN_OFFERS[code]
      return {
        "@type": "Offer",
        name: planNames[code] ?? code,
        price: schemaPrice(offer.priceMonthlyMinor ?? 0, offer.currency),
        priceCurrency: offer.currency,
        url: pageUrl("/pricing", locale),
      }
    })

  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: BRAND.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: pageUrl("/", locale),
    description,
    inLanguage: HREFLANG[locale],
    publisher: { "@id": organizationId() },
    offers,
  }
}

export interface Crumb {
  name: string
  url: string
}

/** Mirrors the visible breadcrumb trail; the last item is the page itself. */
export function breadcrumbJsonLd(crumbs: Crumb[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  }
}

/**
 * Serialised for a `<script type="application/ld+json">`. `<` is escaped so a
 * string can never close the script element (Next.js JSON-LD guide).
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
