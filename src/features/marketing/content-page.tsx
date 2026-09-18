import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { JsonLd } from "@/components/seo/json-ld"
import { InlineCode } from "@/features/docs/inline-code"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { pageMetadata, pageUrl } from "@/lib/seo/metadata"
import { breadcrumbJsonLd } from "@/lib/seo/structured-data"
import { ATTRIBUTION_METADATA_KEY } from "@/lib/tracking/attribution-token"
import { cn } from "@/lib/utils"

import { CONTENT_PAGES, LINK_CARD_KEY, type ContentBlock, type ContentPageKey } from "./content-pages"

/**
 * A search-intent page (SEO_STRATEGY.md): one question a founder types, a
 * complete answer, the product where it genuinely fits, and a way forward.
 *
 * Server-rendered end to end — the H1, the copy, the FAQ and the structured
 * data are all in the first HTML response, with no client component at all.
 * Semantics carry the outline: one `h1`, an `h2` per section, `h3` for points,
 * steps and questions; a breadcrumb `nav`; the guide is an `article` and the
 * outline an `aside`.
 */

export async function contentPageMetadata(key: ContentPageKey, locale: Locale): Promise<Metadata> {
  const page = CONTENT_PAGES[key]
  const t = await getTranslations({ locale, namespace: `seo.pages.${key}` })
  return pageMetadata({
    href: page.href,
    locale,
    title: t("metaTitle"),
    description: t("metaDescription"),
    ogType: "article",
  })
}

const LINK_CLASS = "text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"

/** In-copy links between intents: the catalogue names the words, this names the destination. */
function richTags() {
  const to = (href: "/pricing" | "/docs" | "/saas-affiliate-program" | "/affiliate-software" | "/stripe-affiliates") =>
    function InternalLink(chunks: React.ReactNode) {
      return (
        <Link href={href} className={LINK_CLASS}>
          {chunks}
        </Link>
      )
    }
  return {
    strong: (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>,
    code: (chunks: React.ReactNode) => <InlineCode className="whitespace-normal wrap-anywhere">{chunks}</InlineCode>,
    pricing: to("/pricing"),
    docs: to("/docs"),
    program: to("/saas-affiliate-program"),
    software: to("/affiliate-software"),
    stripe: to("/stripe-affiliates"),
    // Wire identifiers are values, not copy: the catalogue never spells them.
    metadataKey: ATTRIBUTION_METADATA_KEY,
  }
}

export async function ContentPageView({ pageKey, locale }: { pageKey: ContentPageKey; locale: Locale }) {
  const page = CONTENT_PAGES[pageKey]
  const t = await getTranslations(`seo.pages.${pageKey}`)
  const seo = await getTranslations("seo")
  const tags = richTags()

  const crumbs = [
    { name: seo("breadcrumb.home"), url: pageUrl("/", locale) },
    { name: t("breadcrumb"), url: pageUrl(page.href, locale) },
  ]

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <div className="mx-auto w-full max-w-page px-4 sm:px-6">
        <header className="max-w-3xl pb-14 pt-10 sm:pb-20 sm:pt-16">
          <nav aria-label={seo("breadcrumb.label")}>
            <ol className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
              <li>
                <Link href="/" className="transition-colors duration-[120ms] hover:text-foreground">
                  {seo("breadcrumb.home")}
                </Link>
              </li>
              <li aria-hidden="true" className="text-faint-foreground">
                /
              </li>
              <li aria-current="page" className="text-foreground-secondary">
                {t("breadcrumb")}
              </li>
            </ol>
          </nav>

          <p className="mt-8 inline-flex items-center gap-2 rounded-badge border border-border px-2 py-1 text-meta text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-5 text-balance text-heading-sm text-foreground sm:text-heading">{t("title")}</h1>
          <p className="mt-6 max-w-2xl text-pretty text-body text-muted-foreground">{t.rich("lead", tags)}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="primary" size="lg" className="h-11 px-5 sm:h-10">
              <Link href="/signup">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="h-11 px-5 sm:h-10">
              <Link href={page.secondary}>{t("ctaSecondary")}</Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-12 border-t border-border pb-20 pt-12 sm:pb-28 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-16">
          <article className="min-w-0 space-y-14 sm:space-y-16">
            {page.sections.map((section) => (
              <section
                key={section.key}
                id={section.key}
                aria-labelledby={`${section.key}-title`}
                className="scroll-mt-20 space-y-5"
              >
                <h2 id={`${section.key}-title`} className="text-balance text-subheading text-foreground">
                  {t(`sections.${section.key}.title`)}
                </h2>
                {section.blocks.map((block, index) => (
                  <Block
                    key={index}
                    block={block}
                    base={`sections.${section.key}`}
                    t={t}
                    tags={tags}
                  />
                ))}
              </section>
            ))}

            <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 space-y-6">
              <h2 id="faq-title" className="text-subheading text-foreground">
                {seo("faqTitle")}
              </h2>
              <div className="divide-y divide-border-faint border-y border-border-faint">
                {page.faq.map((item) => (
                  <div key={item} className="py-5">
                    <h3 className="text-body font-medium text-foreground">{t(`faq.${item}.question`)}</h3>
                    <p className="mt-2 max-w-reading text-pretty text-body-sm text-foreground-secondary">
                      {t.rich(`faq.${item}.answer`, tags)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </article>

          <aside aria-labelledby="toc-title" className="hidden lg:block">
            <div className="sticky top-24">
              <p id="toc-title" className="text-caption font-medium text-foreground">
                {seo("toc")}
              </p>
              <ol className="mt-3 space-y-2 border-l border-border-faint">
                {page.sections.map((section) => (
                  <li key={section.key}>
                    <a
                      href={`#${section.key}`}
                      className="-ml-px block border-l border-transparent pl-3 text-caption text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:text-foreground"
                    >
                      {t(`sections.${section.key}.title`)}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href="#faq"
                    className="-ml-px block border-l border-transparent pl-3 text-caption text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:text-foreground"
                  >
                    {seo("faqTitle")}
                  </a>
                </li>
              </ol>
            </div>
          </aside>
        </div>
      </div>

      <nav aria-labelledby="related-title" className="border-t border-border">
        <div className="mx-auto w-full max-w-page px-4 py-16 sm:px-6 sm:py-20">
          <h2 id="related-title" className="text-title text-foreground">
            {seo("related")}
          </h2>
          <ul className="mt-6 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            {page.related.map((href) => {
              const cardKey = LINK_CARD_KEY[href]
              if (!cardKey) return null
              return (
                <li key={href} className="bg-surface-1">
                  <Link
                    href={href}
                    className="group flex h-full flex-col gap-1 p-5 transition-colors duration-[120ms] hover:bg-hover"
                  >
                    <span className="flex items-center gap-2 text-ui font-medium text-foreground">
                      {seo(`links.${cardKey}.title`)}
                      <ArrowRight
                        className="size-3.5 text-faint-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="text-pretty text-caption text-muted-foreground">{seo(`links.${cardKey}.body`)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      <section aria-labelledby="closing-title" className="border-t border-border">
        <div className="mx-auto w-full max-w-page px-4 py-16 sm:px-6 sm:py-24">
          <div className="rounded-panel border border-border bg-surface-1 px-6 py-12 text-center sm:px-12 sm:py-16">
            <h2 id="closing-title" className="mx-auto max-w-2xl text-balance text-heading-sm text-foreground">
              {t("closing.title")}
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-pretty text-body text-muted-foreground">{t("closing.body")}</p>
            <Button asChild variant="primary" size="lg" className="mt-8 h-11 px-5 sm:h-10">
              <Link href="/signup">
                {t("closing.cta")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

type Translate = Awaited<ReturnType<typeof getTranslations>>
type Tags = ReturnType<typeof richTags>

const PROSE = "max-w-reading text-pretty text-body-sm text-foreground-secondary sm:text-body"

function Block({ block, base, t, tags }: { block: ContentBlock; base: string; t: Translate; tags: Tags }) {
  switch (block.kind) {
    case "prose":
      return (
        <>
          {Array.from({ length: block.paragraphs }, (_, index) => (
            <p key={index} className={PROSE}>
              {t.rich(`${base}.p${index + 1}`, tags)}
            </p>
          ))}
        </>
      )

    case "note":
      return <p className={cn(PROSE, "text-muted-foreground sm:text-body-sm")}>{t.rich(`${base}.note`, tags)}</p>

    case "points":
      return (
        <ul className="grid gap-x-10 gap-y-6 pt-2 sm:grid-cols-2">
          {block.items.map((item) => (
            <li key={item} className="border-t border-border pt-4">
              <h3 className="text-ui font-medium text-foreground">{t(`${base}.points.${item}.title`)}</h3>
              <p className="mt-1.5 text-pretty text-caption text-muted-foreground">
                {t.rich(`${base}.points.${item}.body`, tags)}
              </p>
            </li>
          ))}
        </ul>
      )

    case "steps":
      return (
        <ol className="space-y-px overflow-hidden rounded-panel border border-border bg-border">
          {block.items.map((item, index) => (
            <li key={item} className="flex gap-4 bg-surface-1 p-5">
              <span className="font-mono text-meta tabular-nums text-faint-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h3 className="text-ui font-medium text-foreground">{t(`${base}.steps.${item}.title`)}</h3>
                <p className="mt-1 text-pretty text-caption text-muted-foreground">
                  {t.rich(`${base}.steps.${item}.body`, tags)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )

    case "table": {
      const [head, ...rest] = block.columns
      return (
        // Scrolls on its own at phone width rather than pushing the page wider;
        // focusable so a keyboard user can scroll it too.
        <div
          role="region"
          aria-label={t(`${base}.table.caption`)}
          tabIndex={0}
          className="overflow-x-auto rounded-panel border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <table className={cn("w-full border-collapse text-left", rest.length > 1 && "min-w-2xl")}>
            <caption className="sr-only">{t(`${base}.table.caption`)}</caption>
            <thead className="bg-surface-2">
              <tr>
                {block.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-border px-4 py-3 text-caption font-medium text-foreground"
                  >
                    {t(`${base}.table.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-surface-1">
              {block.rows.map((row) => (
                <tr key={row} className="border-b border-border-faint last:border-0">
                  <th scope="row" className="px-4 py-3 align-top text-caption font-medium text-foreground">
                    {t.rich(`${base}.table.rows.${row}.${head}`, tags)}
                  </th>
                  {rest.map((column) => (
                    <td key={column} className="px-4 py-3 align-top text-caption text-muted-foreground">
                      {t.rich(`${base}.table.rows.${row}.${column}`, tags)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }
}

