import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { LEGAL, privacyContact } from "@/lib/legal/config"

export type LegalDocumentKey = "terms" | "privacy" | "cookies"

/** Section order per document; each section is `title` + `paragraphs[]` (+ optional `items[]`) in the catalogue. */
export const LEGAL_SECTIONS: Record<LegalDocumentKey, readonly string[]> = {
  terms: ["service", "account", "program", "money", "providers", "subscription", "acceptableUse", "availability", "ip", "suspension", "liability", "changes", "contact"],
  privacy: ["roles", "account", "customerData", "website", "use", "sharing", "security", "retention", "rights", "international", "changes", "contact"],
  cookies: ["what", "site", "customerSite", "choices", "changes"],
}

const textLink = "text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"

/**
 * A legal page: plain reading column, dated, sections from the catalogue.
 * Undecided company facts (`LEGAL`) are left out, never printed as blanks.
 */
export async function LegalDocument({
  doc,
  slots,
}: {
  doc: LegalDocumentKey
  /** Extra content under a section (the cookie tables). */
  slots?: Partial<Record<string, React.ReactNode>>
}) {
  const t = await getTranslations(`legal.${doc}`)
  const common = await getTranslations("legal.common")
  const f = await getFormatters()
  const contact = privacyContact()
  const rich = {
    strong: (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>,
    terms: (chunks: React.ReactNode) => <Link href="/terms" className={textLink}>{chunks}</Link>,
    privacy: (chunks: React.ReactNode) => <Link href="/privacy" className={textLink}>{chunks}</Link>,
    cookies: (chunks: React.ReactNode) => <Link href="/cookies" className={textLink}>{chunks}</Link>,
  }

  return (
    <article className="mx-auto w-full max-w-reading px-4 pb-24 pt-14 sm:px-6">
      <header className="space-y-3 border-b border-border pb-8">
        <p className="text-meta text-muted-foreground">{common("eyebrow")}</p>
        <h1 className="text-balance text-heading-sm text-foreground">{t("title")}</h1>
        <p className="text-pretty text-body text-muted-foreground">{t("lead")}</p>
        <p className="text-meta text-faint-foreground">
          {common("effective", { date: f.date(new Date(`${LEGAL.effectiveDate}T12:00:00Z`)) })}
        </p>
      </header>

      <div className="space-y-10 pt-10">
        {LEGAL_SECTIONS[doc].map((key, index) => {
          const paragraphs = (t.raw(`sections.${key}.paragraphs`) as string[]).map((_, i) =>
            t.rich(`sections.${key}.paragraphs.${i}`, rich),
          )
          const items = t.has(`sections.${key}.items`) ? (t.raw(`sections.${key}.items`) as string[]) : []
          return (
            <section key={key} aria-labelledby={`legal-${key}`} className="space-y-3">
              <h2 id={`legal-${key}`} className="text-title text-foreground">
                <span className="mr-2 font-mono text-caption text-faint-foreground">{index + 1}.</span>
                {t(`sections.${key}.title`)}
              </h2>
              {paragraphs.map((paragraph, i) => (
                <p key={i} className="text-pretty text-body-sm text-foreground-secondary">
                  {paragraph}
                </p>
              ))}
              {items.length ? (
                <ul className="list-disc space-y-1.5 pl-5 text-body-sm text-foreground-secondary">
                  {items.map((_, i) => (
                    <li key={i}>{t.rich(`sections.${key}.items.${i}`, rich)}</li>
                  ))}
                </ul>
              ) : null}
              {key === "contact" ? <ContactBlock contact={contact} /> : null}
              {slots?.[key] ?? null}
            </section>
          )
        })}
      </div>
    </article>
  )
}

async function ContactBlock({ contact }: { contact: string | null }) {
  const common = await getTranslations("legal.common")
  const identity = [LEGAL.companyName, LEGAL.companyRegistration ? common("registration", { value: LEGAL.companyRegistration }) : null, LEGAL.address]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="space-y-1 rounded-panel border border-border bg-surface-1 px-4 py-3 text-body-sm text-foreground-secondary">
      {identity ? <p>{identity}</p> : null}
      {contact ? (
        <p>
          {common("contactLabel")}{" "}
          <a href={`mailto:${contact}`} className={textLink}>
            {contact}
          </a>
        </p>
      ) : (
        <p>{common("contactPending")}</p>
      )}
    </div>
  )
}
