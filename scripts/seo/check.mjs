/**
 * Indexability check against a running server — the rendered-HTML half of the
 * SEO contract (the unit half is src/lib/seo/__tests__/seo.test.ts).
 *
 *   BASE_URL=http://localhost:3100 pnpm seo:check
 *
 * Build the server with the public origin it will be checked on, or canonical
 * URLs will (correctly) point elsewhere:
 *
 *   SITE_INDEXING=on NEXT_PUBLIC_SITE_URL=http://localhost:3100 pnpm build
 *   pnpm start -p 3100
 *
 * The pages to check come from /sitemap.xml itself, so the sitemap is verified
 * by being used: every <loc> must answer 200 with a self-canonical, reciprocal
 * hreflang, one H1, a title, a description and valid JSON-LD. Then a sample of
 * private routes must be noindex or redirect to sign-in. No dependencies: a
 * regex is enough for HTML we generate ourselves.
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "")

const failures = []
let checks = 0
const fail = (where, message) => failures.push(`${where}: ${message}`)
const ok = (condition, where, message) => {
  checks += 1
  if (!condition) fail(where, message)
  return condition
}

async function get(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init })
  const type = response.headers.get("content-type") ?? ""
  const body = /text|xml/.test(type) ? await response.text() : ""
  return { response, body }
}

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]
const tags = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[0])
const decode = (value) => value?.replaceAll("&amp;", "&")

/** Paths on this server for a URL that may carry another origin (the configured public site). */
const pathOf = (url) => {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

async function checkPublicPage(url, alternates) {
  const path = pathOf(url)
  const { response, body } = await get(path)
  if (!ok(response.status === 200, path, `status ${response.status}, expected 200`)) return

  ok(/<html[^>]+lang="(pt-BR|en-US)"/.test(body), path, "missing <html lang>")
  const title = body.match(/<title>([^<]*)<\/title>/)?.[1]
  ok(Boolean(title?.trim()), path, "missing <title>")
  ok(title === undefined || title.length <= 70, path, `title is ${title?.length} chars: "${title}"`)

  const description = tags(body, /<meta[^>]+name="description"[^>]*>/g)[0]
  const descriptionText = description && attr(description, "content")
  ok(Boolean(descriptionText), path, "missing meta description")
  ok(!descriptionText || descriptionText.length <= 160, path, `description is ${descriptionText?.length} chars`)

  const robots = tags(body, /<meta[^>]+name="robots"[^>]*>/g)[0]
  ok(robots !== undefined && /(^|,\s*)index/.test(attr(robots, "content") ?? ""), path, `robots is "${robots && attr(robots, "content")}", expected index`)

  const canonical = tags(body, /<link[^>]+rel="canonical"[^>]*>/g)[0]
  const canonicalHref = canonical && decode(attr(canonical, "href"))
  ok(canonicalHref === url, path, `canonical ${canonicalHref} ≠ ${url}`)
  ok(!canonicalHref?.includes("?"), path, "canonical carries a query string")

  const hreflang = Object.fromEntries(
    tags(body, /<link[^>]+hrefLang="[^"]+"[^>]*>/gi).map((tag) => [attr(tag, "hrefLang") ?? attr(tag, "hreflang"), decode(attr(tag, "href"))]),
  )
  for (const [lang, href] of Object.entries(alternates)) {
    ok(hreflang[lang] === href, path, `hreflang ${lang} is ${hreflang[lang]}, sitemap says ${href}`)
  }

  const h1s = tags(body, /<h1[\s>]/g)
  ok(h1s.length === 1, path, `${h1s.length} <h1> elements, expected 1`)

  for (const name of ["og:title", "og:description", "og:url", "og:type", "og:image", "og:locale"]) {
    ok(new RegExp(`property="${name}"`).test(body), path, `missing ${name}`)
  }
  ok(/name="twitter:card" content="summary_large_image"/.test(body), path, "missing twitter:card")

  const jsonLd = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
  ok(jsonLd.length > 0, path, "no JSON-LD")
  for (const block of jsonLd) {
    try {
      const data = JSON.parse(block)
      ok(!/aggregateRating|"Review"/i.test(block), path, "JSON-LD claims ratings or reviews")
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) ok(item["@context"] === "https://schema.org" && item["@type"], path, "JSON-LD without @context/@type")
    } catch {
      fail(path, "JSON-LD does not parse")
    }
  }

  // Tracking parameters never leak into the canonical.
  const tagged = await get(`${path}${path.includes("?") ? "&" : "?"}utm_source=seo-check&utm_medium=test`)
  const taggedCanonical = decode(attr(tags(tagged.body, /<link[^>]+rel="canonical"[^>]*>/g)[0] ?? "", "href"))
  ok(taggedCanonical === url, path, `canonical with UTM is ${taggedCanonical}`)
}

async function checkPrivate() {
  const noindexPages = ["/pt-br/entrar", "/en/login", "/pt-br/criar-conta", "/en/signup", "/pt-br/esqueci-a-senha", "/en/reset-password"]
  for (const path of noindexPages) {
    const { response, body } = await get(path)
    const robots = tags(body, /<meta[^>]+name="robots"[^>]*>/g)[0]
    ok(robots !== undefined && /noindex/.test(attr(robots, "content") ?? ""), path, `status ${response.status}, robots "${robots && attr(robots, "content")}", expected noindex`)
  }

  // Unknown paths are gated like any private route (src/proxy.ts), so they
  // redirect to a noindex sign-in page rather than serving an indexable 200.
  for (const path of ["/pt-br/acme/visao-geral", "/en/acme/overview", "/pt-br/afiliado", "/en/affiliate/overview", "/pt-br/app", "/en/onboarding", "/pt-br/pagina-que-nao-existe"]) {
    const { response } = await get(path)
    const location = response.headers.get("location") ?? ""
    ok(response.status >= 300 && response.status < 400 && /\/(entrar|login)/.test(location), path, `status ${response.status} → ${location}, expected a redirect to sign-in`)
  }

  const api = await get("/api/health")
  ok(/noindex/.test(api.response.headers.get("x-robots-tag") ?? ""), "/api/health", "missing X-Robots-Tag: noindex")
}

async function main() {
  const robotsTxt = await get("/robots.txt")
  ok(robotsTxt.response.status === 200, "/robots.txt", `status ${robotsTxt.response.status}`)

  const sitemap = await get("/sitemap.xml")
  ok(sitemap.response.status === 200, "/sitemap.xml", `status ${sitemap.response.status}`)
  const entries = [...sitemap.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => {
    const loc = decode(match[1].match(/<loc>([^<]+)<\/loc>/)?.[1])
    const alternates = Object.fromEntries(
      [...match[1].matchAll(/<xhtml:link[^>]+>/g)].map(([tag]) => [attr(tag, "hreflang"), decode(attr(tag, "href"))]),
    )
    return { loc, alternates }
  })

  if (entries.length === 0) {
    // Indexing is off on this build: prove the site says so everywhere.
    ok(/Disallow: \/\s*$/m.test(robotsTxt.body), "/robots.txt", "indexing is off but robots.txt does not disallow /")
    const home = await get("/pt-br")
    ok(/<meta[^>]+name="robots"[^>]+noindex/.test(home.body), "/pt-br", "indexing is off but the home page is not noindex")
    console.log("Indexing is OFF on this build (SITE_INDEXING≠on): only the off-state was checked.")
  } else {
    ok(/^Sitemap: /m.test(robotsTxt.body), "/robots.txt", "no Sitemap line")
    ok(/Disallow: \/api\//.test(robotsTxt.body), "/robots.txt", "does not disallow /api/")
    const locs = new Set(entries.map((entry) => entry.loc))
    for (const { loc, alternates } of entries) {
      ok(Object.keys(alternates).sort().join() === "en,pt-BR,x-default", loc, `sitemap alternates ${Object.keys(alternates)}`)
      for (const href of Object.values(alternates)) ok(locs.has(href), loc, `alternate ${href} is not itself in the sitemap`)
      await checkPublicPage(loc, alternates)
    }
    console.log(`${entries.length} sitemap URLs checked.`)
  }

  await checkPrivate()

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks failed:\n- ${failures.join("\n- ")}`)
    process.exit(1)
  }
  console.log(`All ${checks} checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
