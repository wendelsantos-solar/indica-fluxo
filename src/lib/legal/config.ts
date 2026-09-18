import { BRAND } from "@/lib/brand"

/**
 * Who stands behind the service, for the legal pages. Everything that is not
 * decided yet is `null` — never a placeholder: the pages leave a missing value
 * out rather than print "[CNPJ]". Fill these before the public launch
 * (PRODUCTION_READINESS_REPORT.md, KNOWN_BLOCKERS).
 */
export const LEGAL = {
  /** Razão social. */
  companyName: null as string | null,
  /** CNPJ, as registered. */
  companyRegistration: null as string | null,
  /** Registered address, one line. */
  address: null as string | null,
  /** Where data-subject requests go. Falls back to the support address. */
  privacyEmail: null as string | null,
  supportEmail: BRAND.supportEmail,
  /** Date the current texts took effect (`YYYY-MM-DD`). Bump when they change. */
  effectiveDate: "2026-09-18",
}

/** The address a privacy request should go to, if any exists yet. */
export function privacyContact(): string | null {
  return LEGAL.privacyEmail ?? LEGAL.supportEmail
}

/** Whether the identity of the controller is complete enough to publish commercially. */
export function legalIdentityComplete(): boolean {
  return Boolean(LEGAL.companyName && LEGAL.companyRegistration && privacyContact())
}
