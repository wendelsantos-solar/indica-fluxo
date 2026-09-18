/**
 * Which parts of the catalogue each area of the app sends to the browser.
 *
 * Server Components translate on the server and ship only the resulting text.
 * Client Components need the messages themselves, and a `NextIntlClientProvider`
 * without a `messages` prop serialises the WHOLE catalogue (100+ KB) into the
 * RSC payload of every page — the landing's HTML, every prefetch. Each route
 * group's layout therefore passes only the namespaces its client components
 * read (`clientMessages` in ./client-messages).
 *
 * A nested provider replaces its parent's messages, so every scope is
 * self-sufficient. `__tests__/client-namespaces.test.ts` walks the import
 * graph of each scope and fails when a `useTranslations` call reads something
 * its scope does not ship — a missing message renders as its key path, so
 * this is a test, not a convention.
 */
export const CLIENT_MESSAGE_SCOPES = {
  /** `[locale]/layout.tsx`, the 404 and the redirect-only pages. */
  root: ["notFound"],
  marketing: ["marketing.chrome", "common.locale", "common.theme", "status"],
  auth: ["auth", "errors.emailUnavailable", "success", "common.locale", "common.theme", "status"],
  docs: ["docs.header", "docs.nav", "docs.heading", "docs.code", "common.actions", "common.locale", "common.theme"],
  /** The founder dashboard, the affiliate portal and onboarding. */
  app: [
    "common",
    "nav",
    "palette",
    "status",
    "notFound",
    "forms",
    "dashboard.error",
    "dashboard.notFound",
    "dashboard.payouts.batchStatus",
    "dashboard.settings.team",
    "dashboard.program.affiliateActions",
    "portal.links",
    "portal.commissions",
    "portal.programStatus",
    "portal.payouts.status",
    "portal.participationStatus",
    "portal.participation",
    "portal.notFound",
    "portal.error",
    "portal.defaultLink",
    "plans.names",
    "plans.upgrade",
    "plans.capabilities",
    "plans.audit",
    "onboarding.stepper",
    "billing.banner",
    /** Code samples on Integrations reuse the guide's blocks. */
    "docs.code",
  ],
} as const satisfies Record<string, readonly string[]>

export type ClientMessageScope = keyof typeof CLIENT_MESSAGE_SCOPES

type Messages = { [key: string]: string | Messages }

/** A copy of `messages` holding only the given dotted paths (subtrees or single strings). */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const picked: Messages = {}
  for (const path of paths) {
    const keys = path.split(".")
    let source: string | Messages | undefined = messages
    for (const key of keys) source = typeof source === "object" ? source[key] : undefined
    if (source === undefined) continue

    let target = picked
    for (const key of keys.slice(0, -1)) {
      const next = target[key]
      target = typeof next === "object" ? next : (target[key] = {})
    }
    target[keys[keys.length - 1]!] = source
  }
  return picked
}
