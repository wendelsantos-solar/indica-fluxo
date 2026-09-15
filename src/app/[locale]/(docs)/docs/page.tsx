import {
  ArrowRight,
  Check,
  CreditCard,
  Globe,
  KeyRound,
  Lock,
  MousePointerClick,
  Receipt,
  UserRound,
} from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import type * as React from "react"

import { getFormatters } from "@/i18n/format"
import { getPathname } from "@/i18n/navigation"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { IDENTIFY_RATE_LIMIT } from "@/lib/api/contract"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { localeAlternates, siteUrl } from "@/lib/site"
import { Callout } from "@/features/docs/callout"
import { CodeBlock } from "@/features/docs/code-block"
import { CodeTabs } from "@/features/docs/code-tabs"
import { DocsToc } from "@/features/docs/docs-nav"
import { InlineCode } from "@/features/docs/inline-code"
import { SectionHeading } from "@/features/docs/section-heading"
import {
  COMMISSION_EXAMPLE,
  IDENTIFY_RESPONSE,
  TRACKER_FACTS,
  commissionText,
  identifyCurl,
  identifyTypeScript,
  trackerSnippet,
  webhookUrl,
} from "@/features/docs/snippets"
import { DOCS_GROUPS, sectionAnchor, type DocsSectionKey, type DocsSubsectionKey } from "@/features/docs/structure"
import { DocsSidebarNav } from "@/features/docs/docs-nav"
import { cn } from "@/lib/utils"

export async function generateMetadata({ params }: PageProps<"/[locale]/docs">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs" })
  const { canonical, languages } = localeAlternates("/docs", locale, (target) =>
    getPathname({ href: "/docs", locale: target }),
  )
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
    openGraph: { type: "article", title: t("metaTitle"), description: t("metaDescription"), url: canonical },
  }
}

/** Rich-text tags shared by every translated paragraph in the guide. */
const rich = {
  code: (chunks: React.ReactNode) => <InlineCode>{chunks}</InlineCode>,
  strong: (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>,
}

function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-pretty text-body-sm text-foreground-secondary", className)}>{children}</p>
}

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("space-y-5 border-t border-border-faint pt-10 first:border-0 first:pt-0", className)}>{children}</section>
}

function DefinitionTable({
  head,
  rows,
  label,
}: {
  head: string[]
  rows: React.ReactNode[][]
  label: string
}) {
  return (
    <div data-slot="scrollable" className="overflow-x-auto rounded-panel border border-border">
      <table aria-label={label} className="w-full min-w-lg border-collapse text-caption">
        <thead className="bg-surface-2">
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className="h-9 px-4 text-left font-normal text-muted-foreground">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border-faint align-top">
              {row.map((cell, column) => (
                <td key={column} className={cn("px-4 py-2.5 text-foreground-secondary", column === 0 && "whitespace-nowrap")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The integration guide — one page, laid out like documentation: section
 * sidebar, a reading column, and "on this page". Content lives in the
 * catalogues (prose) and in `features/docs/snippets.ts` (code built from the
 * API's own constants, tested). Statically rendered; the only client leaves
 * are the navigation highlight, copy buttons, code tabs and the drawer.
 */
export default async function DocsPage({ params }: PageProps<"/[locale]/docs">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("docs")
  const current = (await getLocale()) as Locale
  const f = await getFormatters()
  const app = siteUrl().origin
  const anchor = (key: DocsSectionKey | DocsSubsectionKey) => sectionAnchor(key, current)
  const currency = DEFAULT_CURRENCY[current]

  const groups = DOCS_GROUPS.map((group) => ({
    key: group.key,
    label: t(`nav.groups.${group.key}`),
    items: group.sections.map((section) => ({
      id: section.anchors[current],
      label: t(`nav.sections.${section.key}`),
      step: section.step,
    })),
  }))

  const toc = DOCS_GROUPS.flatMap((group) =>
    group.sections.flatMap((section) => [
      { id: section.anchors[current], label: t(`nav.sections.${section.key}`), depth: 2 as const },
      ...(section.children ?? []).map((child) => ({
        id: child.anchors[current],
        label: t(`nav.subsections.${child.key}`),
        depth: 3 as const,
      })),
    ]),
  )

  const flow = [
    { key: "click", icon: MousePointerClick, owner: null },
    { key: "track", icon: Globe, owner: "you" },
    { key: "identify", icon: UserRound, owner: "you" },
    { key: "payment", icon: CreditCard, owner: null },
    { key: "commission", icon: Receipt, owner: "platform" },
  ] as const

  const params_ = TRACKER_FACTS.params.map((param) => `?${param}=`)

  return (
    <div className="mx-auto grid w-full max-w-docs gap-10 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:pt-10 xl:grid-cols-[14rem_minmax(0,1fr)_12rem] xl:gap-12">
      <aside className="hidden lg:block">
        <div data-slot="scrollable" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6 pr-2">
          <DocsSidebarNav groups={groups} label={t("nav.label")} />
        </div>
      </aside>

      <main id="main" className="min-w-0">
        <article className="mx-auto max-w-3xl space-y-12">
          {/* Introduction */}
          <header id={anchor("introduction")} className="scroll-mt-20 space-y-4">
            <nav aria-label={t("breadcrumb.label")} className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <span>{t("breadcrumb.docs")}</span>
              <span aria-hidden="true" className="text-faint-foreground">
                /
              </span>
              <span aria-current="page" className="text-foreground-secondary">
                {t("breadcrumb.current")}
              </span>
            </nav>
            <h1 className="text-balance text-heading-sm text-foreground">{t("intro.title")}</h1>
            <p className="max-w-2xl text-pretty text-body text-muted-foreground">{t("intro.lead")}</p>
            <p className="flex items-start gap-2 text-caption text-foreground-secondary">
              <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />
              {t("intro.outcome")}
            </p>
          </header>

          {/* How it works */}
          <Section>
            <SectionHeading id={anchor("howItWorks")} level={2}>
              {t("howItWorks.title")}
            </SectionHeading>
            <Prose>{t("howItWorks.lead")}</Prose>
            <ol aria-label={t("howItWorks.flowLabel")} className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-5">
              {flow.map((step, index) => (
                <li key={step.key} className="relative flex gap-3 bg-surface-1 p-4 sm:flex-col sm:gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-muted-foreground">
                    <step.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-caption font-medium text-foreground">
                      {t(`howItWorks.steps.${step.key}.title`)}
                      {index < flow.length - 1 ? (
                        <ArrowRight className="size-3.5 text-faint-foreground max-sm:hidden" aria-hidden="true" />
                      ) : null}
                    </p>
                    <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
                      {t.rich(`howItWorks.steps.${step.key}.body`, {
                        ...rich,
                        // Narrow cards: let a code span wrap at its spaces.
                        code: (chunks) => <InlineCode className="whitespace-normal">{chunks}</InlineCode>,
                      })}
                    </p>
                    {step.owner ? (
                      <p
                        className={cn(
                          "mt-2 inline-flex rounded-badge border px-1.5 text-micro",
                          step.owner === "you" ? "border-primary/40 text-primary-text" : "border-border text-faint-foreground",
                        )}
                      >
                        {t(`howItWorks.${step.owner}`)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* Prerequisites */}
          <Section>
            <SectionHeading id={anchor("prerequisites")} level={2}>
              {t("prerequisites.title")}
            </SectionHeading>
            <ul className="space-y-2">
              {(["program", "affiliate", "keys", "stripe", "access"] as const).map((key) => (
                <li key={key} className="flex gap-2.5 text-body-sm text-foreground-secondary">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
                  <span>{t.rich(`prerequisites.items.${key}`, rich)}</span>
                </li>
              ))}
            </ul>
            <Callout tone="info" title={t("prerequisites.keysOnceTitle")}>
              {t("prerequisites.keysOnceBody")}
            </Callout>
          </Section>

          {/* Step 1 — tracker */}
          <Section>
            <SectionHeading id={anchor("installTracker")} level={2} step={1}>
              {t("installTracker.title")}
            </SectionHeading>
            <Prose>{t.rich("installTracker.lead", { ...rich, head: "</head>" })}</Prose>
            <CodeBlock code={trackerSnippet(app)} language="html" filename={t("installTracker.filename")} />
            <SectionHeading id={anchor("trackerDetails")} level={3}>
              {t("installTracker.detailsTitle")}
            </SectionHeading>
            <ul className="space-y-2">
              <DetailItem>
                {t.rich("installTracker.details.params", {
                  ...rich,
                  params: () => (
                    <>
                      {params_.map((param, index) => (
                        <span key={param}>
                          {index > 0 ? ", " : null}
                          <InlineCode>{param}</InlineCode>
                        </span>
                      ))}
                    </>
                  ),
                })}
              </DetailItem>
              <DetailItem>
                {t.rich("installTracker.details.cookie", {
                  ...rich,
                  cookie: TRACKER_FACTS.cookie,
                  days: TRACKER_FACTS.cookieDays,
                })}
              </DetailItem>
              <DetailItem>{t.rich("installTracker.details.send", rich)}</DetailItem>
              <DetailItem>{t("installTracker.details.noRef")}</DetailItem>
            </ul>
            <Callout tone="success" title={t("installTracker.testTitle")}>
              {t.rich("installTracker.testBody", rich)}
            </Callout>
          </Section>

          {/* Step 2 — identify */}
          <Section>
            <SectionHeading id={anchor("identifyCustomer")} level={2} step={2}>
              {t("identifyCustomer.title")}
            </SectionHeading>
            <Prose>{t.rich("identifyCustomer.lead", rich)}</Prose>
            <Callout tone="danger" title={t("identifyCustomer.securityTitle")}>
              {t.rich("identifyCustomer.securityBody", rich)}
            </Callout>
            <CodeTabs
              label={t("code.samples")}
              copyLabel={t("code.copy")}
              samples={[
                { id: "curl", title: "cURL", language: "bash", code: identifyCurl(app) },
                { id: "typescript", title: "TypeScript", language: "typescript", code: identifyTypeScript(app) },
              ]}
            />
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("identifyCustomer.response")}</p>
              <CodeBlock code={IDENTIFY_RESPONSE} language="json" copy={false} />
              <Prose className="text-caption">{t.rich("identifyCustomer.responseBody", rich)}</Prose>
            </div>

            <SectionHeading id={anchor("visitorId")} level={3}>
              {t("identifyCustomer.visitorIdTitle")}
            </SectionHeading>
            <Prose>{t.rich("identifyCustomer.visitorIdBody", { ...rich, cookie: TRACKER_FACTS.cookie })}</Prose>

            <SectionHeading id={anchor("identifyFields")} level={3}>
              {t("identifyCustomer.fieldsTitle")}
            </SectionHeading>
            <DefinitionTable
              label={t("identifyCustomer.fieldsTitle")}
              head={[t("fields.name"), t("fields.type"), t("fields.description")]}
              rows={(
                [
                  ["visitorId", true],
                  ["externalId", true],
                  ["providerCustomerId", false],
                  ["email", false],
                  ["provider", false],
                ] as const
              ).map(([field, required]) => [
                <InlineCode key="field">{field}</InlineCode>,
                <span key="type" className="whitespace-nowrap text-muted-foreground">
                  string · {required ? t("fields.required") : t("fields.optional")}
                </span>,
                t.rich(`fields.${field}`, rich),
              ])}
            />
            <Callout tone="warning" title={t("identifyCustomer.stripeIdTitle")}>
              {t.rich("identifyCustomer.stripeIdBody", rich)}
            </Callout>
          </Section>

          {/* Step 3 — Stripe */}
          <Section>
            <SectionHeading id={anchor("connectStripe")} level={2} step={3}>
              {t("connectStripe.title")}
            </SectionHeading>
            <Prose>{t("connectStripe.lead")}</Prose>
            <ol className="space-y-2">
              {(["account", "webhook", "secret"] as const).map((key, index) => (
                <li key={key} className="flex gap-3 text-body-sm text-foreground-secondary">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-meta text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">
                    {t.rich(`connectStripe.steps.${key}`, {
                      ...rich,
                      a: (chunks) => (
                        <a href={`#${anchor("webhookEvents")}`} className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                          {chunks}
                        </a>
                      ),
                    })}
                  </span>
                </li>
              ))}
            </ol>
            <CodeBlock
              code={webhookUrl(app, t("connectStripe.urlPlaceholder"))}
              language="text"
              filename={t("connectStripe.urlLabel")}
            />
            <Prose>{t.rich("connectStripe.verify", rich)}</Prose>
            <div className="grid gap-3 md:grid-cols-2">
              <Callout tone="info" title={t("connectStripe.idempotentTitle")}>
                {t("connectStripe.idempotentBody")}
              </Callout>
              <Callout tone="warning" title={t("connectStripe.currencyTitle")}>
                {t("connectStripe.currencyBody")}
              </Callout>
            </div>
          </Section>

          {/* Step 4 — commission */}
          <Section>
            <SectionHeading id={anchor("commission")} level={2} step={4}>
              {t("commission.title")}
            </SectionHeading>
            <Prose>{t("commission.lead")}</Prose>
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-panel border border-border bg-surface-1 p-4 sm:gap-4 sm:p-5">
              <Figure label={t("commission.payment")} value={f.money(COMMISSION_EXAMPLE.baseMinor, currency)} />
              <span aria-hidden="true" className="text-body text-faint-foreground">
                ×
              </span>
              <Figure label={t("commission.rate")} value={f.basisPoints(COMMISSION_EXAMPLE.rateBps)} />
              <span aria-hidden="true" className="text-body text-faint-foreground">
                =
              </span>
              <Figure label={t("commission.result")} value={f.money(COMMISSION_EXAMPLE.commissionMinor, currency)} emphasis />
            </div>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("commission.implementation")}</p>
              <CodeBlock code={commissionText()} language="text" copy={false} />
              <Prose className="text-caption">{t("commission.implementationBody")}</Prose>
            </div>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("commission.conditionsTitle")}</p>
              <ul className="space-y-1.5">
                {(["approved", "currency", "window", "duration"] as const).map((key) => (
                  <DetailItem key={key}>{t(`commission.conditions.${key}`)}</DetailItem>
                ))}
              </ul>
            </div>
            <SectionHeading id={anchor("commissionLifecycle")} level={3}>
              {t("commission.lifecycleTitle")}
            </SectionHeading>
            <ol className="space-y-1.5">
              {(["pending", "available", "approved", "paid", "reversed"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`commission.lifecycle.${key}`, rich)}</DetailItem>
              ))}
            </ol>
          </Section>

          {/* Step 5 — verify */}
          <Section>
            <SectionHeading id={anchor("verify")} level={2} step={5}>
              {t("verify.title")}
            </SectionHeading>
            <Prose>{t("verify.lead")}</Prose>
            <ol className="space-y-2">
              {(["click", "identify", "payment", "commission"] as const).map((key, index) => (
                <li key={key} className="flex gap-3 text-body-sm text-foreground-secondary">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-meta text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{t.rich(`verify.steps.${key}`, rich)}</span>
                </li>
              ))}
            </ol>
            <Callout tone="success" title={t("verify.doneTitle")}>
              {t("verify.doneBody")}
            </Callout>
          </Section>

          {/* Concepts */}
          <Section>
            <SectionHeading id={anchor("attribution")} level={2}>
              {t("attribution.title")}
            </SectionHeading>
            <Prose>{t("attribution.lead")}</Prose>
            <SectionHeading id={anchor("attributionWindow")} level={3}>
              {t("attribution.windowTitle")}
            </SectionHeading>
            <Prose>{t("attribution.windowBody")}</Prose>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <SectionHeading id={anchor("firstClick")} level={3}>
                  {t("attribution.firstClickTitle")}
                </SectionHeading>
                <Prose>{t("attribution.firstClickBody")}</Prose>
              </div>
              <div className="space-y-2">
                <SectionHeading id={anchor("lastClick")} level={3}>
                  {t("attribution.lastClickTitle")}
                </SectionHeading>
                <Prose>{t("attribution.lastClickBody")}</Prose>
              </div>
            </div>
          </Section>

          <Section>
            <SectionHeading id={anchor("holdPeriod")} level={2}>
              {t("holdPeriod.title")}
            </SectionHeading>
            <Prose>{t("holdPeriod.body")}</Prose>
          </Section>

          {/* Security */}
          <Section>
            <SectionHeading id={anchor("apiKeys")} level={2}>
              {t("apiKeys.title")}
            </SectionHeading>
            <Prose>{t("apiKeys.lead")}</Prose>
            <div className="grid gap-3 md:grid-cols-2">
              <KeyCard
                icon={Globe}
                title={t("apiKeys.publishable.title")}
                sample="pk_live_…"
                where={t("apiKeys.publishable.where")}
                uses={[t.rich("apiKeys.publishable.uses.tracker", rich), t("apiKeys.publishable.uses.clicks")]}
              />
              <KeyCard
                icon={Lock}
                title={t("apiKeys.secret.title")}
                sample="sk_live_…"
                where={t("apiKeys.secret.where")}
                uses={[t.rich("apiKeys.secret.uses.identify", rich), t("apiKeys.secret.uses.env")]}
                danger
              />
            </div>
            <Callout tone="warning" title={t("apiKeys.rotateTitle")}>
              {t("apiKeys.rotateBody")}
            </Callout>
          </Section>

          {/* Reference */}
          <Section>
            <SectionHeading id={anchor("identifyApi")} level={2}>
              {t("identifyApi.title")}
            </SectionHeading>
            <dl className="divide-y divide-border-faint overflow-hidden rounded-panel border border-border text-caption">
              {[
                [t("identifyApi.method"), <InlineCode key="m">POST</InlineCode>],
                [t("identifyApi.endpoint"), <InlineCode key="e">/api/identify</InlineCode>],
                [t("identifyApi.auth"), t.rich("identifyApi.authValue", rich)],
                [
                  t("identifyApi.body"),
                  t.rich("identifyApi.bodyValue", {
                    a: (chunks) => (
                      <a href={`#${anchor("identifyFields")}`} className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                        {chunks}
                      </a>
                    ),
                  }),
                ],
                [t("identifyApi.rateLimit"), t("identifyApi.rateLimitValue", { count: IDENTIFY_RATE_LIMIT })],
                [t("identifyApi.cors"), t("identifyApi.corsValue")],
              ].map(([term, value], index) => (
                <div key={index} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-foreground-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section>
            <SectionHeading id={anchor("webhookEvents")} level={2}>
              {t("webhookEvents.title")}
            </SectionHeading>
            <Prose>{t("webhookEvents.lead")}</Prose>
            <DefinitionTable
              label={t("webhookEvents.title")}
              head={[t("webhookEvents.event"), t("webhookEvents.records")]}
              rows={STRIPE_HANDLED_EVENTS.map((event) => [
                <InlineCode key="type">{event.type}</InlineCode>,
                t(`webhookEvents.types.${event.records}`),
              ])}
            />
          </Section>

          <Section>
            <SectionHeading id={anchor("errors")} level={2}>
              {t("errors.title")}
            </SectionHeading>
            <Prose>{t.rich("errors.lead", { ...rich, json: '{ "error": "code" }' })}</Prose>
            <DefinitionTable
              label={t("errors.title")}
              head={[t("errors.code"), t("errors.status"), t("errors.meaning")]}
              rows={(
                [
                  ["missing_credentials", 401],
                  ["unauthorized", 401],
                  ["invalid_payload", 400],
                  ["invalid_visitor", 400],
                  ["validation_error", 422],
                  ["unknown_key", 401],
                  ["invalid_ref", 400],
                  ["rate_limited", 429],
                  ["internal_error", 500],
                ] as const
              ).map(([code, status]) => [
                <InlineCode key="code">{code}</InlineCode>,
                <span key="status" className="font-mono tabular-nums text-muted-foreground">
                  {status}
                </span>,
                t.rich(`errors.items.${code}`, rich),
              ])}
            />
          </Section>
        </article>
      </main>

      <aside className="hidden xl:block">
        <div data-slot="scrollable" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6">
          <DocsToc title={t("nav.onThisPage")} items={toc} />
        </div>
      </aside>
    </div>
  )
}

function DetailItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-body-sm text-foreground-secondary">
      <span className="mt-2.5 size-1 shrink-0 rounded-full bg-faint-foreground" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Figure({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-meta text-muted-foreground">{label}</p>
      <p className={cn("mt-1 whitespace-nowrap tabular-nums", emphasis ? "text-title text-foreground" : "text-ui text-foreground-secondary sm:text-title")}>
        {value}
      </p>
    </div>
  )
}

function KeyCard({
  icon: Icon,
  title,
  sample,
  where,
  uses,
  danger = false,
}: {
  icon: typeof KeyRound
  title: string
  sample: string
  where: string
  uses: React.ReactNode[]
  danger?: boolean
}) {
  return (
    <div className="rounded-panel border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-control border border-border bg-surface-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium text-foreground">{title}</p>
          <p className={cn("text-meta", danger ? "text-danger-foreground" : "text-muted-foreground")}>{where}</p>
        </div>
      </div>
      <p className="mt-3">
        <InlineCode>{sample}</InlineCode>
      </p>
      <ul className="mt-3 space-y-1.5">
        {uses.map((use, index) => (
          <li key={index} className="flex gap-2 text-caption text-foreground-secondary">
            <Check className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            <span>{use}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
