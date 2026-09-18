import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import robots from "@/app/robots"
import sitemap from "@/app/sitemap"
import { CONTENT_PAGES } from "@/features/marketing/content-pages"
import { withBrand } from "@/i18n/request"
import { routing } from "@/i18n/routing"
import { BRAND } from "@/lib/brand"
import { PLAN_OFFERS } from "@/lib/plans"

import { indexingEnabled, isIndexableHost, pageAlternates, pageMetadata } from "../metadata"
import { COMPARISON_MAX_AGE_DAYS, INDEXABLE_PAGES, type IndexablePage } from "../pages"
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  softwareApplicationJsonLd,
} from "../structured-data"

/**
 * The SEO contract, as assertions: what may be indexed, how each page names
 * itself (canonical, hreflang), what the sitemap and robots.txt publish, and
 * that structured data never states something the site does not.
 * The rendered-HTML half (status, H1, meta tags) is `scripts/seo/check.mjs`.
 */

const SITE = "https://www.example-brand.com"

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE)
  vi.stubEnv("SITE_INDEXING", "on")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Canonical pathnames that must never be indexable, whatever else changes. */
const PRIVATE = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/app",
  "/logout",
  "/affiliate",
  "/[workspaceSlug]",
]

describe("indexable registry", () => {
  it("lists only routes the locale router knows", () => {
    const known = Object.keys(routing.pathnames)
    for (const page of INDEXABLE_PAGES) expect(known, page.href).toContain(page.href)
  })

  it("never contains a private route", () => {
    for (const page of INDEXABLE_PAGES) {
      for (const prefix of PRIVATE) {
        expect(page.href === prefix || page.href.startsWith(`${prefix}/`), `${page.href} is private`).toBe(false)
      }
    }
  })

  it("has a real content date on every page", () => {
    for (const page of INDEXABLE_PAGES) {
      expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(page.updated))).toBe(false)
    }
  })

  it("keeps every comparison page freshly verified", () => {
    const now = Date.now()
    for (const page of INDEXABLE_PAGES as readonly IndexablePage[]) {
      if (page.intent !== "comparison") continue
      expect(page.verifiedOn, `${page.href} needs verifiedOn`).toBeDefined()
      const age = (now - Date.parse(page.verifiedOn!)) / 86_400_000
      expect(age, `${page.href} comparison is stale`).toBeLessThanOrEqual(COMPARISON_MAX_AGE_DAYS)
    }
  })
})

describe("canonical and hreflang", () => {
  it("is absolute and self-referencing for every page in every locale", () => {
    for (const page of INDEXABLE_PAGES) {
      for (const locale of routing.locales) {
        const { canonical, languages } = pageAlternates(page.href, locale)
        const url = new URL(canonical)
        expect(url.origin).toBe(SITE)
        expect(url.search).toBe("")
        expect(url.hash).toBe("")
        expect(url.pathname.startsWith(`/${locale}`)).toBe(true)
        expect(languages[locale === "en" ? "en" : "pt-BR"]).toBe(canonical)
      }
    }
  })

  it("declares pt-BR, en and x-default, pointing at each page's own equivalent", () => {
    for (const page of INDEXABLE_PAGES) {
      const { languages } = pageAlternates(page.href, "pt-br")
      expect(Object.keys(languages).sort()).toEqual(["en", "pt-BR", "x-default"])
      expect(languages["pt-BR"]).not.toBe(languages.en)
      expect(languages["x-default"]).toBe(languages.en)
      // Both locales agree on the set, so the relationship is reciprocal.
      expect(pageAlternates(page.href, "en").languages).toEqual(languages)
    }
  })

  it("pairs each search-intent page with its written-for-the-market twin", () => {
    const pairs = {
      "/saas-affiliate-program": ["/pt-br/programa-de-afiliados-saas", "/en/affiliate-software-for-saas"],
      "/affiliate-software": ["/pt-br/software-de-afiliados-saas", "/en/affiliate-management-software"],
      "/stripe-affiliates": ["/pt-br/afiliados-stripe", "/en/stripe-affiliate-software"],
    } as const
    for (const [href, [pt, en]] of Object.entries(pairs)) {
      const { languages } = pageAlternates(href as keyof typeof pairs, "pt-br")
      expect(languages["pt-BR"]).toBe(`${SITE}${pt}`)
      expect(languages.en).toBe(`${SITE}${en}`)
    }
  })
})

describe("indexing gate for previews and temporary hosts", () => {
  it("never indexes a Vercel preview or development deployment, even with SITE_INDEXING=on", () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    expect(indexingEnabled()).toBe(false)
    vi.stubEnv("VERCEL_ENV", "development")
    expect(indexingEnabled()).toBe(false)
    vi.stubEnv("VERCEL_ENV", "production")
    expect(indexingEnabled()).toBe(true)
    vi.stubEnv("VERCEL_ENV", "")
  })

  it("never indexes *.vercel.app, localhost or an IP as the site's home", () => {
    for (const host of ["refvia.vercel.app", "localhost", "127.0.0.1", "app.localhost"]) expect(isIndexableHost(host), host).toBe(false)
    expect(isIndexableHost("refvia.com.br")).toBe(true)
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://refvia-git-main.vercel.app")
    expect(indexingEnabled()).toBe(false)
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE)
  })

  it("is off by default: a production deploy without SITE_INDEXING=on stays noindex", () => {
    vi.stubEnv("SITE_INDEXING", "")
    vi.stubEnv("VERCEL_ENV", "production")
    expect(indexingEnabled()).toBe(false)
    vi.stubEnv("SITE_INDEXING", "on")
    vi.stubEnv("VERCEL_ENV", "")
  })
})

describe("page metadata", () => {
  it("indexes a registered page only when indexing is on", () => {
    const on = pageMetadata({ href: "/pricing", locale: "en", title: "Pricing", description: "d" })
    expect(on.robots).toEqual({ index: true, follow: true })

    vi.stubEnv("SITE_INDEXING", "")
    const off = pageMetadata({ href: "/pricing", locale: "en", title: "Pricing", description: "d" })
    expect(off.robots).toEqual({ index: false, follow: true })
  })

  it("carries Open Graph and a large Twitter card", () => {
    const meta = pageMetadata({ href: "/docs", locale: "pt-br", title: "Guia", description: "d", ogType: "article" })
    expect(meta.openGraph).toMatchObject({
      type: "article",
      siteName: BRAND.name,
      url: `${SITE}/pt-br/documentacao`,
      locale: "pt_BR",
      alternateLocale: ["en_US"],
      title: `Guia | ${BRAND.name}`,
    })
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" })
    // No handle is invented while the brand has none.
    if (!BRAND.social.x) expect(meta.twitter).not.toHaveProperty("site")
  })
})

describe("sitemap.xml", () => {
  it("lists every indexable page once per locale, with alternates and real dates", () => {
    const entries = sitemap()
    expect(entries).toHaveLength(INDEXABLE_PAGES.length * routing.locales.length)
    const urls = entries.map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const entry of entries) {
      expect(entry.url.startsWith(`${SITE}/`)).toBe(true)
      expect(entry).not.toHaveProperty("priority")
      expect(entry.lastModified).toBeInstanceOf(Date)
      expect(Object.keys(entry.alternates?.languages ?? {}).sort()).toEqual(["en", "pt-BR", "x-default"])
    }
  })

  it("contains no private surface", () => {
    for (const { url } of sitemap()) {
      expect(url).not.toMatch(/\/(entrar|login|criar-conta|signup|afiliado|affiliate\/|app|api)(\/|$)/)
    }
  })

  it("is empty while indexing is off", () => {
    vi.stubEnv("SITE_INDEXING", "")
    expect(sitemap()).toEqual([])
  })
})

describe("robots.txt", () => {
  it("allows the site, blocks machine and private surfaces, and advertises the sitemap", () => {
    const rules = robots()
    expect(rules.sitemap).toBe(`${SITE}/sitemap.xml`)
    const rule = Array.isArray(rules.rules) ? rules.rules[0]! : rules.rules
    expect(rule.allow).toBe("/")
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/pt-br/app", "/en/app", "/pt-br/afiliado/", "/en/affiliate/"]))
  })

  it("disallows everything while indexing is off", () => {
    vi.stubEnv("SITE_INDEXING", "")
    const rules = robots()
    expect(rules.rules).toEqual({ userAgent: "*", disallow: "/" })
    expect(rules.sitemap).toBeUndefined()
  })
})

describe("structured data", () => {
  it("never claims ratings or reviews", () => {
    const all = serializeJsonLd([
      organizationJsonLd(),
      softwareApplicationJsonLd({ locale: "en", description: "d", planNames: {} }),
    ])
    expect(all).not.toMatch(/aggregateRating|"Review"|reviewCount|ratingValue/i)
  })

  it("offers exactly the published plans at their published prices", () => {
    const app = softwareApplicationJsonLd({ locale: "pt-br", description: "d", planNames: {} }) as {
      offers: { price: string; priceCurrency: string }[]
    }
    const published = Object.values(PLAN_OFFERS).filter((offer) => offer.public && offer.priceMonthlyMinor !== null)
    expect(app.offers).toHaveLength(published.length)
    expect(app.offers.map((offer) => offer.price)).toEqual(
      published.map((offer) => ((offer.priceMonthlyMinor ?? 0) / 100).toFixed(2)),
    )
  })

  it("escapes `<` so a value can never close the script element", () => {
    expect(serializeJsonLd(breadcrumbJsonLd([{ name: "</script><b>", url: SITE }]))).not.toContain("<")
  })
})

describe("brand", () => {
  const catalogue = (locale: string) => readFileSync(join(process.cwd(), `src/i18n/messages/${locale}.json`), "utf8")

  it("is never spelled in a catalogue — only `{brand}`", () => {
    for (const locale of routing.locales) expect(catalogue(locale)).not.toContain(BRAND.name)
  })

  it("keeps arrays as arrays, branded, for `t.raw` readers", () => {
    expect(withBrand({ list: ["{brand} a", "b"] } as never, "Refvia")).toEqual({ list: ["Refvia a", "b"] })
  })

  it("is substituted before messages are formatted", () => {
    expect(withBrand({ a: "{brand} — x", b: { c: "© {brand}" } }, "Refvia")).toEqual({
      a: "Refvia — x",
      b: { c: "© Refvia" },
    })
  })
})

describe("content pages", () => {
  type Tree = { [key: string]: string | Tree }
  const load = (locale: string) =>
    JSON.parse(readFileSync(join(process.cwd(), `src/i18n/messages/${locale}.json`), "utf8")) as Tree
  const get = (tree: Tree, path: string) =>
    path.split(".").reduce<string | Tree | undefined>((node, key) => (typeof node === "object" ? node[key] : undefined), tree)

  it("every page is registered as indexable", () => {
    const hrefs = INDEXABLE_PAGES.map((page) => page.href as string)
    for (const page of Object.values(CONTENT_PAGES)) expect(hrefs).toContain(page.href)
  })

  it("every key the layout reads exists in every catalogue", () => {
    for (const locale of routing.locales) {
      const tree = load(locale)
      for (const page of Object.values(CONTENT_PAGES)) {
        const base = `seo.pages.${page.key}`
        const keys = ["metaTitle", "metaDescription", "breadcrumb", "eyebrow", "title", "lead", "ctaPrimary", "ctaSecondary", "closing.title", "closing.body", "closing.cta"].map((key) => `${base}.${key}`)
        for (const section of page.sections) {
          const s = `${base}.sections.${section.key}`
          keys.push(`${s}.title`)
          for (const block of section.blocks) {
            if (block.kind === "prose") for (let i = 1; i <= block.paragraphs; i++) keys.push(`${s}.p${i}`)
            if (block.kind === "note") keys.push(`${s}.note`)
            if (block.kind === "points") for (const item of block.items) keys.push(`${s}.points.${item}.title`, `${s}.points.${item}.body`)
            if (block.kind === "steps") for (const item of block.items) keys.push(`${s}.steps.${item}.title`, `${s}.steps.${item}.body`)
            if (block.kind === "table") {
              keys.push(`${s}.table.caption`)
              for (const column of block.columns) {
                keys.push(`${s}.table.columns.${column}`)
                for (const row of block.rows) keys.push(`${s}.table.rows.${row}.${column}`)
              }
            }
          }
        }
        for (const item of page.faq) keys.push(`${base}.faq.${item}.question`, `${base}.faq.${item}.answer`)
        for (const key of keys) expect(typeof get(tree, key), `${locale}: ${key}`).toBe("string")
      }
    }
  })

  it("never links a page to itself as related reading", () => {
    for (const page of Object.values(CONTENT_PAGES)) expect(page.related).not.toContain(page.href)
  })

  it("steers away from the B2C affiliate intents it must not rank for", () => {
    for (const locale of routing.locales) {
      const text = JSON.stringify(get(load(locale), "seo")).toLowerCase()
      for (const term of ["shopee", "shein", "temu", "amazon", "ganhar dinheiro", "curso de afiliado", "make money"]) {
        expect(text, `${locale} mentions ${term}`).not.toContain(term)
      }
    }
  })
})
