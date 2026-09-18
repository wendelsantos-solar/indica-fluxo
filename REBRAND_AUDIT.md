# REBRAND_AUDIT.md

IndicaFluxo → **Refvia**. Every occurrence of `IndicaFluxo`, `Indica Fluxo`
and `indicafluxo` found by a global search (excluding `node_modules`, `.next`,
`.git`), classified and acted on. Date: 2026-09-18.

Classifications: **PUBLIC_BRAND** (seen by a user) · **TECHNICAL_COMPATIBILITY**
(an identifier customers' systems or stored data already depend on) ·
**HISTORICAL_DOC** · **MIGRATION** · **TEST_FIXTURE** · **CODE_COMMENT**.

## Source of truth

`src/lib/brand.ts` → `BRAND.name = "Refvia"`. Every visible use reads it:
catalogues write `{brand}` (substituted in `src/i18n/request.ts`), components
read `BRAND.name` — navbar/logo text, footer, metadata titles, Open Graph
`siteName`/alt, Twitter card, JSON-LD `Organization`/`SoftwareApplication`,
`applicationName`, social cards, docs snippets (`REFVIA_SECRET_KEY`, the
identify error message), the Asaas webhook name/user-agent. The rename was one
line; the catalogues contained no literal name (enforced by the existing test
"is never spelled in a catalogue"). Domains are not in `BRAND`: they come from
`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` (`src/lib/site.ts`).

## Occurrences

| OLD_REFERENCE | LOCATION | CLASSIFICATION | ACTION | REASON |
| --- | --- | --- | --- | --- |
| `name: "IndicaFluxo"` | `src/lib/brand.ts` | PUBLIC_BRAND | → `Refvia` | single source of the public name |
| `indicafluxo_ref` | `src/lib/tracking/attribution-token.ts` (`ATTRIBUTION_METADATA_KEY`), tracker, adapters, docs field table, tests | TECHNICAL_COMPATIBILITY | **kept** | Stripe/Mercado Pago metadata key already written into founders' checkout code and live Stripe objects |
| `indicafluxo_customer` | `CUSTOMER_METADATA_KEY`, fixtures, tests | TECHNICAL_COMPATIBILITY | **kept** | same |
| `ifx_` token prefix, `ifx_stripe_oauth` cookie | attribution tokens, Stripe OAuth state | TECHNICAL_COMPATIBILITY | **kept** | stored tokens, in-flight OAuth state |
| `_referral_id`, `_referral_ref` | tracker cookies | TECHNICAL_COMPATIBILITY | **kept** | set on customers' sites; renaming loses every open attribution |
| `indica_last_workspace`, `indica-theme`, `indica.sidebar.collapsed` | cookie / localStorage keys | TECHNICAL_COMPATIBILITY | **kept** | renaming silently resets users' preferences; not visible |
| `indica_app` | Postgres role (migration 0009) | TECHNICAL_COMPATIBILITY | **kept** | database role granted by migrations |
| "IndicaFluxo" in comments (21 source files: pricing, payouts, docs page, track route, platform-billing routes/services/types, schema, env, plans, stripe-connect, sandbox…) | `src/**` | CODE_COMMENT | → `Refvia` | keep code prose consistent with the product |
| `sandbox.indicafluxo.invalid` | `src/server/services/sandbox.ts` | CODE_COMMENT (fallback landing URL of a simulated click, `.invalid` TLD) | → `sandbox.refvia.invalid` | not a real host; rows already written keep the old string, harmless |
| shiki theme name `indicafluxo` | `src/features/docs/highlight.ts` | CODE_COMMENT (internal id) | → `refvia` | internal, never rendered |
| `app.indicafluxo.com(.br)`, `app.indicafluxo.test` | tracker, invite, snippet tests | TEST_FIXTURE | → `app.refvia.*` | fixtures only |
| "IndicaFluxo" | `.env.example` comments | CODE_COMMENT | → `Refvia` | |
| `# indica-fluxo`, "IndicaFluxo" | `README.md`, `CLAUDE.md`, `DESIGN.md`, `ARCHITECTURE.md`, `docs/PLANS.md`, `SEO_CONTENT_MAP.md` | living docs | → `Refvia` (the `indicafluxo_ref` mentions stay) | these guide future work |
| `"name": "indica-fluxo"` | `package.json` | CODE_COMMENT (private package) | → `refvia` | never published |
| repository folder `indica-fluxo` | local path | — | kept | outside the codebase |
| "IndicaFluxo" in `0012_access_followups.sql` and other migrations | `src/server/db/migrations/**` | MIGRATION | **kept** | applied history is never rewritten |
| "IndicaFluxo" in audits/reports (`BUSINESS_VIABILITY_AUDIT.md` 23, `INTEGRATION_ARCHITECTURE_V2.md` 8, `SEO_AUDIT.md` 5, …) | root `*.md` | HISTORICAL_DOC | kept | dated records of past rounds |

## Visual identity

The mark is two strokes merging into one (a referral becoming a path) with no
text — it fits "Refvia" and is kept. `src/app/icon.svg` and `favicon.ico`
carry the same mark, no lettering; OG/social cards render `BRAND.name` from
code. No raster asset carried the old name. No manifest/PWA file exists.

## Result

Visible old-brand references: **0** (source, catalogues, rendered HTML of
home, pricing, docs, legal, auth checked on a production-like build).
Enforced by `src/lib/__tests__/release-readiness.test.ts` ("never shows the old
name…", whitelist: `indicafluxo_ref`, `indicafluxo_customer`; migrations and
`brand.ts` excluded).
