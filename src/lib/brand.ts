/**
 * The brand, in one place.
 *
 * The public name is Refvia (renamed from IndicaFluxo, 2026-09). Nothing else
 * in the codebase spells the name: components read `BRAND.name`,
 * and the message catalogues write `{brand}`, which `src/i18n/request.ts`
 * replaces with this value before any string is formatted. Renaming the
 * product is a change to this file plus the domain in the environment
 * (`NEXT_PUBLIC_SITE_URL`, see `src/lib/site.ts`).
 *
 * What does NOT follow a rename, on purpose: wire identifiers already embedded
 * in customers' systems — the `ifx_` attribution-token prefix, the
 * `indicafluxo_ref` Stripe metadata key and the tracker's cookie names. Changing
 * those breaks live integrations; a rename must keep accepting the old ones.
 *
 * The category ("programa de afiliados para SaaS" / "affiliate software for
 * SaaS") is copy, so it lives in the catalogues (`meta.*`), not here.
 */
export const BRAND = {
  name: "Refvia",

  /**
   * Public contact address. `null` until a monitored mailbox exists: an address
   * nobody reads is worse than none, and structured data must not advertise it.
   */
  supportEmail: null as string | null,

  /**
   * Official profiles. Each stays `null` until the account really exists —
   * `twitter:site` and `Organization.sameAs` are only emitted for real handles.
   */
  social: {
    /** Without the `@`. */
    x: null as string | null,
    linkedin: null as string | null,
    github: null as string | null,
  },
} as const

/** Profile URLs for `Organization.sameAs`, omitting any that do not exist yet. */
export function brandProfiles(): string[] {
  const { x, linkedin, github } = BRAND.social
  return [x ? `https://x.com/${x}` : null, linkedin, github].filter((url): url is string => Boolean(url))
}
