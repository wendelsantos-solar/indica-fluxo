import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { routing } from "@/i18n/routing"
import { BRAND } from "@/lib/brand"
import { COOKIES } from "@/lib/legal/cookies"
import { STRIPE_OAUTH_STATE_COOKIE_NAME } from "@/lib/legal/cookie-names"
import { INDEXABLE_PAGES } from "@/lib/seo/pages"
import { ACQUISITION_COOKIE } from "@/lib/seo/acquisition"
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace"
import { ATTRIBUTION_TOKEN_COOKIE } from "@/lib/tracking/attribution-token"
import { VISITOR_COOKIE } from "@/lib/tracking/constants"

/**
 * Release gates for the Refvia launch (REBRAND_AUDIT.md, COOKIE_AUDIT.md):
 * no old public brand, no temporary domain, legal pages reachable and listed,
 * every cookie in code documented.
 */
const ROOT = process.cwd()

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const SOURCE = files(join(ROOT, "src")).filter((path) => /\.(ts|tsx|json|css|svg)$/.test(path))

/**
 * Where the old name may still appear, and why: identifiers already installed
 * in customers' systems (Stripe metadata keys) and historical migrations.
 */
const OLD_BRAND_ALLOWED = [
  /indicafluxo_ref/g, // ATTRIBUTION_METADATA_KEY — in founders' checkout code and Stripe objects
  /indicafluxo_customer/g, // CUSTOMER_METADATA_KEY — same
]

describe("brand", () => {
  it("is Refvia", () => {
    expect(BRAND.name).toBe("Refvia")
  })

  it("never shows the old name in source or copy — only whitelisted compatibility identifiers", () => {
    const offenders: string[] = []
    for (const path of SOURCE) {
      const rel = relative(ROOT, path)
      if (rel.includes("/migrations/")) continue // historical, never rewritten
      if (rel === "src/lib/brand.ts") continue // records the rename itself
      if (rel === "src/lib/__tests__/release-readiness.test.ts") continue
      let text = readFileSync(path, "utf8")
      for (const allowed of OLD_BRAND_ALLOWED) text = text.replace(allowed, "")
      if (/indica\s?fluxo/i.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

describe("domain", () => {
  it("hardcodes no temporary or personal domain anywhere the product reads", () => {
    const banned = /fazproposta|wendelpaco\.dev|\.vercel\.app\/|ngrok|trycloudflare/i
    const offenders = [...SOURCE, join(ROOT, "next.config.ts"), join(ROOT, ".env.example")]
      .filter((path) => !path.includes("__tests__"))
      .filter((path) => banned.test(readFileSync(path, "utf8").replace(/\*\.vercel\.app|\.vercel\.app"\)/g, "")))
      .map((path) => relative(ROOT, path))
    expect(offenders).toEqual([])
  })
})

describe("legal pages", () => {
  const paths = { "/terms": ["/termos", "/terms"], "/privacy": ["/privacidade", "/privacy"], "/cookies": ["/cookies", "/cookies"] } as const

  it("exist in both locales under their own slugs", () => {
    for (const [href, [pt, en]] of Object.entries(paths)) {
      expect(routing.pathnames[href as keyof typeof routing.pathnames]).toEqual({ "pt-br": pt, en })
    }
  })

  it("are public and registered for canonical + hreflang (never behind the login)", () => {
    const hrefs = INDEXABLE_PAGES.map((page) => page.href as string)
    for (const href of Object.keys(paths)) expect(hrefs).toContain(href)
  })

  it("are linked from the marketing, docs and auth frames, and from sign-up", () => {
    const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
    expect(read("src/app/[locale]/(marketing)/_components/site-footer.tsx")).toContain("<LegalLinks")
    expect(read("src/app/[locale]/(docs)/layout.tsx")).toContain("<LegalLinks")
    expect(read("src/app/[locale]/(auth)/layout.tsx")).toContain("<LegalLinks")
    const signup = read("src/features/auth/sign-up-flow.tsx")
    expect(signup).toContain('href="/terms"')
    expect(signup).toContain('href="/privacy"')
  })

  it("never print a placeholder for undecided company facts", () => {
    for (const locale of routing.locales) {
      const text = JSON.stringify(JSON.parse(readFileSync(join(ROOT, `src/i18n/messages/${locale}.json`), "utf8")).legal)
      expect(text).not.toMatch(/\[[A-Z ]{3,}\]|INSIRA|INSERT|TODO|XX\.XXX/)
    }
  })
})

describe("cookie inventory", () => {
  it("lists every cookie name the code sets", () => {
    const names = COOKIES.map((cookie) => cookie.name)
    for (const name of [VISITOR_COOKIE, ATTRIBUTION_TOKEN_COOKIE, ACQUISITION_COOKIE, LAST_WORKSPACE_COOKIE, STRIPE_OAUTH_STATE_COOKIE_NAME, "NEXT_LOCALE"]) {
      expect(names, name).toContain(name)
    }
  })
})
