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
import * as React from "react"

import { getFormatters } from "@/i18n/format"
import { Link, getPathname } from "@/i18n/navigation"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { IDENTIFY_RATE_LIMIT } from "@/lib/api/contract"
import { CONNECTOR_IDS, CONNECTORS } from "@/lib/billing/catalog"
import type { ReasonCode } from "@/lib/billing/reasons"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { checkoutBridgeSnippet } from "@/features/integrations/bridge-snippets"
import { StatusPill } from "@/features/docs/status-pill"
import { BETA_CONNECTORS, bridgeFieldNames } from "@/features/docs/universal"
import { FanDiagram, PathList } from "@/features/docs/diagrams"
import { JsonLd } from "@/components/seo/json-ld"
import { appUrl } from "@/lib/site"
import { pageMetadata, pageUrl } from "@/lib/seo/metadata"
import { breadcrumbJsonLd } from "@/lib/seo/structured-data"
import { ExpectedResult, FactList, StateFlow, Steps, Timeline } from "@/features/docs/blocks"
import { Callout } from "@/features/docs/callout"
import { CodeBlock } from "@/features/docs/code-block"
import { CodeTabs } from "@/features/docs/code-tabs"
import { DocsToc, type DocsTocGroup } from "@/features/docs/docs-nav"
import { InlineCode } from "@/features/docs/inline-code"
import { SectionHeading } from "@/features/docs/section-heading"
import {
  COMMISSION_EXAMPLE,
  IDENTIFY_RESPONSE,
  STRIPE_TRIGGER_COMMAND,
  TRACKER_FACTS,
  commissionText,
  attributionTokenFromBrowser,
  customerFirstSnippet,
  checkoutSessionSnippet,
  identifyCurl,
  identifyEndpoint,
  identifyTypeScript,
  paymentIntentSnippet,
  paymentLinkSnippet,
  subscriptionApiSnippet,
  stripeEventsText,
  trackerSnippet,
  visitorIdFromCookie,
  visitorIdFromForm,
  webhookUrl,
} from "@/features/docs/snippets"
import { BETA_PROVIDER_ANCHORS, DOCS_GROUPS, sectionAnchor, type DocsSectionKey, type DocsSubsectionKey } from "@/features/docs/structure"
import { DocsSidebarNav } from "@/features/docs/docs-nav"
import { docsNavGroups } from "@/features/docs/nav"
import { cn } from "@/lib/utils"

export async function generateMetadata({ params }: PageProps<"/[locale]/docs">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs" })
  return pageMetadata({
    href: "/docs",
    locale: locale as Locale,
    title: t("metaTitle"),
    description: t("metaDescription"),
    ogType: "article",
  })
}

/** Rich-text tags shared by every translated paragraph in the guide. */
const rich = {
  code: (chunks: React.ReactNode) => <InlineCode>{chunks}</InlineCode>,
  strong: (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>,
}

/**
 * Running text keeps a reading measure (720px) while code, tables and the flow
 * use the full column — wide samples, short lines.
 */
function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("max-w-reading text-pretty text-body-sm text-foreground-secondary", className)}>{children}</p>
}

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("space-y-4 border-t border-border-faint pt-10 first:border-0 first:pt-0", className)}>{children}</section>
}

const textLink = "text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"

/**
 * The identify body as `identifyBodySchema` enforces it (src/lib/api/contract.ts),
 * plus the visitor-id format checked in the route. Types are the API's own
 * vocabulary, so they are not translated.
 */
const IDENTIFY_FIELDS = [
  { field: "visitorId", type: "string", required: "yes" },
  { field: "externalId", type: "string", required: "yes" },
  { field: "providerCustomerId", type: "string | null", required: "recommended" },
  { field: "email", type: "string | null", required: "no" },
  { field: "provider", type: '"stripe" | "mercado_pago" | "abacatepay" | "asaas"', required: "no" },
] as const

/**
 * Every code each endpoint can answer with, in the order the route checks
 * them: src/app/api/identify/route.ts, src/app/api/track/route.ts and
 * src/app/api/webhooks/stripe/[integrationId]/route.ts (+ ../responses.ts).
 */
const ERROR_GROUPS = [
  {
    key: "identify",
    codes: [
      ["rate_limited", 429],
      ["missing_credentials", 401],
      ["invalid_payload", 400],
      ["invalid_visitor", 400],
      ["unauthorized", 401],
      ["validation_error", 422],
      ["LIVE_MODE_REQUIRED", 402],
      ["SUBSCRIPTION_REQUIRED", 402],
      ["internal_error", 500],
    ],
  },
  {
    key: "track",
    codes: [
      ["rate_limited", 429],
      ["invalid_payload", 400],
      ["invalid_ref", 400],
      ["invalid_visitor", 400],
      ["unknown_key", 401],
      // `recordClick` answers 204 for a live key without live mode before it
      // looks the code up, so the 204 row precedes the 404 (tracking.ts).
      ["no_content", 204],
      ["not_found", 404],
      ["internal_error", 500],
    ],
  },
  {
    key: "webhook",
    codes: [
      ["not_found", 404],
      ["missing_signature", 400],
      ["invalid_signature", 400],
      ["livemode_mismatch", 400],
      ["processing_failed", 500],
      ["duplicate", 200],
      ["ignored", 200],
    ],
  },
] as const

/** The reasons a founder meets most, in the order they are usually checked. */
const DOCUMENTED_REASONS: ReasonCode[] = [
  "NO_ATTRIBUTION",
  "ATTRIBUTION_EXPIRED",
  "AFFILIATE_INACTIVE",
  "RECURRENCE_WINDOW_CLOSED",
  "CURRENCY_MISMATCH",
  "CUSTOMER_NOT_LINKED",
  "TEST_LIVE_MISMATCH",
  "TOKEN_CONFLICT",
]

/** Webhook 200s carry a flag, not an `error` code: shown as the body field. */
const RESPONSE_LABEL: Partial<Record<string, string>> = {
  duplicate: '"duplicate": true',
  ignored: '"ignored": …',
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
    <>
      {/* Phones: one block per row, each value under its column name — a
          four-column table at 343px is all scrolling and three-word lines. */}
      <ul aria-label={label} className="divide-y divide-border-faint overflow-hidden rounded-panel border border-border text-caption sm:hidden [&_dd_code]:whitespace-normal [&_dd_code]:break-all">
        {rows.map((row, index) => (
          <li key={index} className="space-y-1.5 px-4 py-3">
            <div className="text-foreground">{row[0]}</div>
            <dl className="space-y-1">
              {row.slice(1).map((cell, column) =>
                head[column + 1] ? (
                  <div key={column} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
                    <dt className="text-muted-foreground">{head[column + 1]}</dt>
                    <dd className="min-w-0 text-foreground-secondary">{cell}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </li>
        ))}
      </ul>
      <div data-slot="scrollable" className="hidden overflow-x-auto rounded-panel border border-border sm:block">
        <table aria-label={label} className="w-full min-w-lg border-collapse text-caption">
          <thead className="bg-surface-2">
            <tr>
              {head.map((cell, index) => (
                <th key={index} scope="col" className="h-9 px-4 text-left font-normal text-muted-foreground">
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
    </>
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
  const app = appUrl().origin
  const anchor = (key: DocsSectionKey | DocsSubsectionKey) => sectionAnchor(key, current)
  const currency = DEFAULT_CURRENCY[current]

  const anchorLink = (key: DocsSectionKey | DocsSubsectionKey) =>
    function AnchorLink(chunks: React.ReactNode) {
      return (
        <a href={`#${anchor(key)}`} className={textLink}>
          {chunks}
        </a>
      )
    }
  const errorsLink = anchorLink("errors")
  const eventsLink = anchorLink("webhookEvents")
  const environmentsLink = anchorLink("environments")
  const attributionWindowLink = anchorLink("attributionWindow")
  const holdPeriodLink = anchorLink("holdPeriod")
  const fieldsLink = anchorLink("identifyFields")
  const customerFirstLink = anchorLink("customerFirst")
  const tReasons = await getTranslations("dashboard.integrations.reasons")
  const betaGuide = getPathname({ href: "/docs/beta", locale: current })
  const responseLink = anchorLink("identifyResponse")

  const groups = docsNavGroups({
    t,
    locale: current,
    page: "guide",
    guidePath: getPathname({ href: "/docs", locale: current }),
    betaPath: betaGuide,
  })

  const toc: DocsTocGroup[] = DOCS_GROUPS.map((group) => ({
    key: group.key,
    label: t(`nav.groups.${group.key}`),
    items: group.sections.map((section) => ({
      id: section.anchors[current],
      label: t(`nav.sections.${section.key}`),
      children: (section.children ?? []).map((child) => ({ id: child.anchors[current], label: t(`nav.subsections.${child.key}`) })),
    })),
  }))
  const betaAnchor = (id: (typeof BETA_CONNECTORS)[number]) => `${betaGuide}#${BETA_PROVIDER_ANCHORS[id]}`

  // Who carries out each step, as the code does it: the visitor follows the
  // affiliate link; Refvia's tracker (/t.js → /api/track) records the
  // visit; the founder's server calls /api/identify; Stripe delivers the
  // payment webhook; Refvia computes the commission.
  const flow = [
    { key: "click", icon: MousePointerClick, actor: "visitor" },
    { key: "track", icon: Globe, actor: "platform" },
    { key: "identify", icon: UserRound, actor: "you" },
    { key: "payment", icon: CreditCard, actor: "stripe" },
    { key: "commission", icon: Receipt, actor: "platform" },
  ] as const

  const params_ = TRACKER_FACTS.params.map((param) => `?${param}=`)

  return (
    <div className="mx-auto grid w-full max-w-docs gap-10 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:pt-10 xl:grid-cols-[14rem_minmax(0,1fr)_13rem] xl:gap-12">
      <aside className="hidden lg:block">
        <div data-slot="scrollable" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6 pr-4">
          <DocsSidebarNav groups={groups} label={t("nav.label")} />
        </div>
      </aside>

      <main id="main" className="min-w-0">
        <JsonLd
          data={breadcrumbJsonLd([
            { name: t("breadcrumb.docs"), url: pageUrl("/docs", current) },
            { name: t("breadcrumb.current"), url: pageUrl("/docs", current) },
          ])}
        />
        <article className="mx-auto max-w-detail space-y-10">
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
            <p className="max-w-reading text-pretty text-body text-muted-foreground">{t("intro.lead")}</p>
            {/* The guide's promise: an editorial aside, not a box — a tone edge
                on a barely-there tint, quieter than the title. */}
            <div className="flex max-w-reading items-start gap-3 rounded-r-control border-l-2 border-success bg-surface-1 py-3 pl-4 pr-4 text-caption">
              <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{t("intro.outcomeTitle")}</p>
                <p className="mt-0.5 text-foreground-secondary">{t("intro.outcome")}</p>
              </div>
            </div>
          </header>

          <Section>
            <SectionHeading id={anchor("quickstart")} level={2}>
              {t("quickstart.title")}
            </SectionHeading>
            <Prose>{t("quickstart.lead")}</Prose>
            <Steps
              label={t("quickstart.label")}
              items={[
                {
                  key: "install",
                  title: t("quickstart.steps.install.title"),
                  body: <p>{t.rich("quickstart.steps.install.body", { ...rich, head: "</head>", a: anchorLink("installTracker") })}</p>,
                  children: <CodeBlock code={trackerSnippet(app)} language="html" filename={t("installTracker.filename")} />,
                },
                {
                  key: "identify",
                  title: t("quickstart.steps.identify.title"),
                  body: <p>{t.rich("quickstart.steps.identify.body", { ...rich, a: anchorLink("identifyCustomer") })}</p>,
                  children: <CodeBlock code={customerFirstSnippet(app)} language="typescript" title={t("quickstart.steps.identify.codeTitle")} />,
                },
                {
                  key: "connect",
                  title: t("quickstart.steps.connect.title"),
                  body: <p>{t.rich("quickstart.steps.connect.body", rich)}</p>,
                  children: (
                    <ul aria-label={t("quickstart.steps.connect.label")} className="flex flex-wrap gap-2">
                      {CONNECTOR_IDS.map((id) => (
                        <li key={id}>
                          <a
                            href={id === "stripe" ? `#${anchor("connectStripe")}` : betaAnchor(id)}
                            className="inline-flex h-8 items-center gap-2 rounded-control border border-border bg-surface-1 px-3 text-caption text-foreground transition-colors duration-[120ms] hover:border-border-strong"
                          >
                            {CONNECTORS[id].name}
                            {id === "stripe" ? (
                              <StatusPill tone="stable">{t("connectStripe.status")}</StatusPill>
                            ) : (
                              <StatusPill tone="beta">{t("nav.beta")}</StatusPill>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ),
                },
                {
                  key: "test",
                  title: t("quickstart.steps.test.title"),
                  body: <p>{t.rich("quickstart.steps.test.body", { ...rich, a: anchorLink("verify") })}</p>,
                },
                {
                  key: "commission",
                  title: t("quickstart.steps.commission.title"),
                  body: <p>{t.rich("quickstart.steps.commission.body", { ...rich, a: anchorLink("missingCommission") })}</p>,
                },
              ]}
            />
            {/* The guide's aha: integration and billing are separate (brief §25). */}
            <Callout tone="success" title={t("quickstart.oneIntegrationTitle")}>
              {t.rich("quickstart.oneIntegrationBody", { ...rich, a: anchorLink("multipleProviders") })}
            </Callout>

            <SectionHeading id={anchor("prerequisites")} level={3}>
              {t("prerequisites.title")}
            </SectionHeading>
            <Prose>{t("prerequisites.lead")}</Prose>
            <ul className="max-w-reading space-y-2.5">
              {(["program", "affiliate", "keys", "stripe", "access"] as const).map((key) => (
                <li key={key} className="flex gap-3 text-body-sm text-foreground-secondary">
                  <Check className="mt-1 size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
                  <span className="min-w-0">{t.rich(`prerequisites.items.${key}`, rich)}</span>
                </li>
              ))}
            </ul>
            <Callout tone="info" title={t("prerequisites.keysOnceTitle")}>
              {t("prerequisites.keysOnceBody")}
            </Callout>
          </Section>

          {/* How it works */}
          <Section>
            <SectionHeading id={anchor("howItWorks")} level={2}>
              {t("howItWorks.title")}
            </SectionHeading>
            <Prose>{t("howItWorks.lead")}</Prose>
            <FanDiagram
              label={t("howItWorks.diagram.label")}
              description={t("howItWorks.diagram.description")}
              top={[
                { key: "referral", label: t("howItWorks.diagram.referral") },
                { key: "tracker", label: t("howItWorks.diagram.tracker") },
                { key: "customer", label: t("howItWorks.diagram.customer"), emphasis: true },
              ]}
              branchesLabel={t("howItWorks.diagram.branches")}
              branches={CONNECTOR_IDS.map((id) => ({
                key: id,
                label: CONNECTORS[id].name,
                badge: id === "stripe" ? undefined : t("nav.beta"),
              }))}
              bottom={[
                { key: "transaction", label: t("howItWorks.diagram.transaction") },
                { key: "commission", label: t("howItWorks.diagram.commission"), emphasis: true },
              ]}
            />
            <p className="pt-2 text-caption font-medium text-foreground">{t("howItWorks.flowTitle")}</p>
            {/* Five columns only when the column itself is wide (≥ 768px); a
                narrower column — tablet, or desktop with both rails — gets rows. */}
            <div className="@container">
              <ol aria-label={t("howItWorks.flowLabel")} className="grid gap-px overflow-hidden rounded-panel border border-border bg-border @3xl:grid-cols-5">
                {flow.map((step, index) => {
                  const actor = (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-badge border border-border bg-fill px-1.5 text-micro text-muted-foreground">
                      <span className="sr-only">{t("howItWorks.actorLabel")} </span>
                      {t(`howItWorks.actors.${step.actor}`)}
                    </span>
                  )
                  return (
                    <li key={step.key} className="flex items-start gap-3 bg-surface-1 px-4 py-4 @3xl:flex-col @3xl:items-stretch @3xl:gap-4 @3xl:py-5">
                      <div className="flex shrink-0 items-center justify-between gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-muted-foreground">
                          <step.icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="hidden @3xl:inline-flex">{actor}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-h-5 items-center gap-1.5 text-caption font-medium text-foreground">
                          <span className="font-mono text-meta font-normal text-faint-foreground" aria-hidden="true">
                            {index + 1}
                          </span>
                          {t(`howItWorks.steps.${step.key}.title`)}
                          {index < flow.length - 1 ? (
                            <ArrowRight className="size-3.5 text-faint-foreground @max-3xl:hidden" aria-hidden="true" />
                          ) : null}
                          <span className="ml-auto @3xl:hidden">{actor}</span>
                        </p>
                        <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">
                          {t.rich(`howItWorks.steps.${step.key}.body`, {
                            ...rich,
                            // Narrow cards: code at the card's own size, wrapping at its spaces.
                            code: (chunks) => <InlineCode className="whitespace-normal text-meta">{chunks}</InlineCode>,
                          })}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </Section>

          {/* Step 1 — tracker */}
          <Section>
            <SectionHeading id={anchor("installTracker")} level={2}>
              {t("installTracker.title")}
            </SectionHeading>
            <Prose>{t.rich("installTracker.lead", { ...rich, head: "</head>" })}</Prose>
            <CodeBlock code={trackerSnippet(app)} language="html" filename={t("installTracker.filename")} />
            <FactList
              rows={[
                [t("installTracker.facts.where"), t.rich("installTracker.facts.whereValue", { ...rich, head: "</head>" })],
                [t("installTracker.facts.key"), t.rich("installTracker.facts.keyValue", rich)],
                [t("installTracker.facts.sends"), t.rich("installTracker.facts.sendsValue", rich)],
              ]}
            />
            <SectionHeading id={anchor("trackerDetails")} level={3}>
              {t("installTracker.detailsTitle")}
            </SectionHeading>
            <ul className="max-w-reading space-y-2">
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
              <DetailItem>{t.rich("installTracker.details.subdomain", rich)}</DetailItem>
              <DetailItem>{t.rich("installTracker.details.send", rich)}</DetailItem>
              <DetailItem>{t.rich("installTracker.details.noRef", rich)}</DetailItem>
            </ul>
            <ExpectedResult title={t("expected")}>
              <p>{t.rich("installTracker.expected.ok", rich)}</p>
              <p>{t.rich("installTracker.expected.check", { ...rich, errors: errorsLink })}</p>
            </ExpectedResult>
          </Section>

          {/* Step 3 — identify, the advanced path */}
          <Section>
            <SectionHeading id={anchor("identifyCustomer")} level={2}>
              {t("identifyCustomer.title")}
            </SectionHeading>
            <Callout tone="success" title={t("identifyCustomer.optionalTitle")}>
              {t.rich("identifyCustomer.optionalBody", { ...rich, a: customerFirstLink, b: rich.strong })}
            </Callout>
            <Prose>{t.rich("identifyCustomer.lead", rich)}</Prose>
            <FactList
              rows={[
                [t("identifyCustomer.facts.when"), t.rich("identifyCustomer.facts.whenValue", rich)],
                [t("identifyCustomer.facts.where"), t.rich("identifyCustomer.facts.whereValue", rich)],
                [t("identifyCustomer.facts.endpoint"), <InlineCode key="endpoint">POST /api/identify</InlineCode>],
                [t("identifyCustomer.facts.auth"), t.rich("identifyCustomer.facts.authValue", rich)],
              ]}
            />
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

            <SectionHeading id={anchor("visitorId")} level={3}>
              {t("identifyCustomer.visitorIdTitle")}
            </SectionHeading>
            <Prose>{t.rich("identifyCustomer.visitorIdBody", { ...rich, cookie: TRACKER_FACTS.cookie })}</Prose>
            <CodeTabs
              label={t("identifyCustomer.visitorIdTitle")}
              copyLabel={t("code.copy")}
              samples={[
                { id: "cookie", title: t("identifyCustomer.visitorIdTabs.cookie"), language: "typescript", code: visitorIdFromCookie() },
                { id: "form", title: t("identifyCustomer.visitorIdTabs.form"), language: "html", code: visitorIdFromForm() },
              ]}
            />

            <SectionHeading id={anchor("identifyFields")} level={3}>
              {t("identifyCustomer.fieldsTitle")}
            </SectionHeading>
            <DefinitionTable
              label={t("identifyCustomer.fieldsTitle")}
              head={[t("fields.name"), t("fields.type"), t("fields.required"), t("fields.description")]}
              rows={IDENTIFY_FIELDS.map(({ field, type, required }) => [
                <InlineCode key="field">{field}</InlineCode>,
                <span key="type" className="font-mono text-meta text-muted-foreground">
                  {type}
                </span>,
                <span key="required" className={cn(required === "yes" ? "text-foreground" : "text-muted-foreground")}>
                  {t(`fields.requiredValues.${required}`)}
                </span>,
                t.rich(`fields.${field}`, rich),
              ])}
            />
            <Callout tone="warning" title={t("identifyCustomer.stripeIdTitle")}>
              {t.rich("identifyCustomer.stripeIdBody", rich)}
            </Callout>

            <SectionHeading id={anchor("identifyResponse")} level={3}>
              {t("identifyCustomer.responseTitle")}
            </SectionHeading>
            <CodeBlock code={IDENTIFY_RESPONSE} language="json" title="HTTP 200" />
            <ul className="max-w-reading space-y-1.5">
              <DetailItem>{t.rich("identifyCustomer.responseFields.ok", rich)}</DetailItem>
              <DetailItem>{t.rich("identifyCustomer.responseFields.customerId", rich)}</DetailItem>
              <DetailItem>{t.rich("identifyCustomer.responseFields.attributionsBound", rich)}</DetailItem>
            </ul>
            <Prose>{t.rich("identifyCustomer.responseErrors", { ...rich, errors: errorsLink })}</Prose>
            <ExpectedResult title={t("expected")}>
              <p>{t.rich("identifyCustomer.expected.ok", rich)}</p>
              <p>{t.rich("identifyCustomer.expected.zero", rich)}</p>
            </ExpectedResult>
          </Section>

          {/* The recommended integration */}
          <Section>
            <SectionHeading id={anchor("customerFirst")} level={2}>
              {t("customerFirst.title")}
            </SectionHeading>
            <Prose>{t("customerFirst.lead")}</Prose>
            <PathList
              label={t("customerFirst.flowLabel")}
              steps={(["referred", "signup", "identified", "pays", "recognised", "commission"] as const).map((key) => ({
                key,
                label: t(`customerFirst.flow.${key}`),
              }))}
            />
            <Prose>{t.rich("customerFirst.codeLead", rich)}</Prose>
            <CodeBlock code={customerFirstSnippet(app)} language="typescript" title={t("customerFirst.codeTitle")} />
            <Prose className="text-caption">{t.rich("customerFirst.codeNote", { ...rich, a: fieldsLink })}</Prose>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("customerFirst.matchTitle")}</p>
              <Prose className="text-caption">{t("customerFirst.matchLead")}</Prose>
              <ol className="max-w-reading list-decimal space-y-1.5 pl-5 text-body-sm text-foreground-secondary">
                {(["identity", "metadata", "reference", "email"] as const).map((key) => (
                  <li key={key}>{t.rich(`customerFirst.match.${key}`, { ...rich, a: anchorLink("checkoutBridge") })}</li>
                ))}
              </ol>
            </div>
            <Callout tone="info" title={t("customerFirst.practiceTitle")}>
              {t.rich("customerFirst.practice", { ...rich, a: anchorLink("checkoutBridge") })}
            </Callout>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("customerFirst.rulesTitle")}</p>
              <Prose className="text-caption">{t("customerFirst.rulesBody")}</Prose>
              <ul className="max-w-reading space-y-1.5">
                {(["window", "duration", "affiliate", "currency", "environment", "model", "program"] as const).map((key) => (
                  <DetailItem key={key}>{t.rich(`customerFirst.rules.${key}`, { ...rich, a: anchorLink("programPause") })}</DetailItem>
                ))}
              </ul>
            </div>
          </Section>

          <Section>
            <SectionHeading id={anchor("guestCheckout")} level={2}>
              {t("guestCheckout.title")}
            </SectionHeading>
            <Prose>{t("guestCheckout.lead")}</Prose>
            <PathList
              label={t("guestCheckout.flowLabel")}
              steps={(["referral", "reference", "checkout", "provider", "webhook", "attribution"] as const).map((key) => ({
                key,
                label: t(`guestCheckout.flow.${key}.label`),
                note: t.rich(`guestCheckout.flow.${key}.note`, rich),
              }))}
            />
            <Prose>{t.rich("guestCheckout.how", { ...rich, a: anchorLink("checkoutBridge"), stripe: anchorLink("checkoutMethods") })}</Prose>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("guestCheckout.limitsTitle")}</p>
              <ul className="max-w-reading space-y-1.5">
                {(["first", "expiry", "none"] as const).map((key) => (
                  <DetailItem key={key}>{t(`guestCheckout.limits.${key}`)}</DetailItem>
                ))}
              </ul>
            </div>
          </Section>

          {/* Stripe — the same shape every payment method's page has (brief §33). */}
          <Section>
            <SectionHeading
              id={anchor("connectStripe")}
              level={2}
              badge={<StatusPill tone="stable">{t("connectStripe.status")}</StatusPill>}
            >
              {t("connectStripe.title")}
            </SectionHeading>
            <Prose>{t.rich("connectStripe.lead", rich)}</Prose>
            <FactList
              rows={(["need", "does", "supported", "limits", "test"] as const).map((key) => [
                t(`connectStripe.facts.${key}`),
                t.rich(`connectStripe.facts.${key}Value`, { ...rich, a: anchorLink("refunds") }),
              ])}
            />
            <SectionHeading id={anchor("stripeManual")} level={3}>
              {t("connectStripe.manualTitle")}
            </SectionHeading>
            <Prose>{t.rich("connectStripe.manualLead", rich)}</Prose>
            <Steps
              label={t("connectStripe.stepsLabel")}
              items={[
                {
                  key: "account",
                  title: t("connectStripe.steps.account.title"),
                  body: <p>{t.rich("connectStripe.steps.account.body", rich)}</p>,
                },
                {
                  key: "endpoint",
                  title: t("connectStripe.steps.endpoint.title"),
                  body: (
                    <>
                      <p>{t.rich("connectStripe.steps.endpoint.body", rich)}</p>
                      <ul className="space-y-1">
                        {(["account", "snapshot", "customer"] as const).map((key) => (
                          <DetailItem key={key}>{t.rich(`connectStripe.steps.endpoint.checklist.${key}`, rich)}</DetailItem>
                        ))}
                      </ul>
                    </>
                  ),
                  children: (
                    <CodeBlock
                      code={webhookUrl(app, t("connectStripe.urlPlaceholder"))}
                      language="text"
                      title={t("connectStripe.urlLabel")}
                    />
                  ),
                },
                {
                  key: "events",
                  title: t("connectStripe.steps.events.title"),
                  body: <p>{t.rich("connectStripe.steps.events.body", { ...rich, a: eventsLink, count: STRIPE_HANDLED_EVENTS.length })}</p>,
                  children: (
                    <CodeBlock
                      code={stripeEventsText(STRIPE_HANDLED_EVENTS.map((event) => event.type))}
                      language="text"
                      title={t("connectStripe.eventsLabel")}
                    />
                  ),
                },
                {
                  key: "secret",
                  title: t("connectStripe.steps.secret.title"),
                  body: <p>{t.rich("connectStripe.steps.secret.body", rich)}</p>,
                },
                {
                  key: "confirm",
                  title: t("connectStripe.steps.confirm.title"),
                  body: <p>{t.rich("connectStripe.steps.confirm.body", rich)}</p>,
                  children: <CodeBlock code={STRIPE_TRIGGER_COMMAND} language="shell" />,
                },
              ]}
            />
            <Callout tone="info" title={t("connectStripe.modesTitle")}>
              {t.rich("connectStripe.modesBody", { ...rich, a: environmentsLink })}
            </Callout>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("connectStripe.notesTitle")}</p>
              <ul className="max-w-reading space-y-1.5">
                {(["idempotent", "retry", "currency"] as const).map((key) => (
                  <DetailItem key={key}>{t.rich(`connectStripe.notes.${key}`, rich)}</DetailItem>
                ))}
              </ul>
            </div>
            <ExpectedResult title={t("expected")}>
              <p>{t.rich("connectStripe.expected.ok", rich)}</p>
              <p>{t.rich("connectStripe.expected.check", { ...rich, errors: errorsLink })}</p>
            </ExpectedResult>
          </Section>

          {/* Stripe — checkout reference (guest checkout) */}
          <Section>
            <SectionHeading id={anchor("checkoutMethods")} level={2}>
              {t("checkoutMethods.title")}
            </SectionHeading>
            <Prose>{t.rich("checkoutMethods.lead", rich)}</Prose>
            <CodeBlock
              code={attributionTokenFromBrowser()}
              language="typescript"
              filename={t("checkoutMethods.browserFilename")}
            />
            <FactList
              rows={[
                [t("checkoutMethods.facts.value"), t.rich("checkoutMethods.facts.valueValue", rich)],
                [t("checkoutMethods.facts.organic"), t.rich("checkoutMethods.facts.organicValue", rich)],
                [t("checkoutMethods.facts.renewal"), t.rich("checkoutMethods.facts.renewalValue", rich)],
              ]}
            />

            <SectionHeading id={anchor("checkoutHosted")} level={3}>
              {t("checkoutMethods.hosted.title")}
            </SectionHeading>
            <Prose>{t.rich("checkoutMethods.hosted.body", rich)}</Prose>
            <CodeBlock code={checkoutSessionSnippet()} language="typescript" />

            <SectionHeading id={anchor("checkoutLinks")} level={3}>
              {t("checkoutMethods.links.title")}
            </SectionHeading>
            <Prose>{t.rich("checkoutMethods.links.body", rich)}</Prose>
            <CodeBlock code={paymentLinkSnippet()} language="html" />
            <Callout tone="warning" title={t("checkoutMethods.links.calloutTitle")}>
              {t.rich("checkoutMethods.links.calloutBody", rich)}
            </Callout>

            <SectionHeading id={anchor("checkoutCustom")} level={3}>
              {t("checkoutMethods.custom.title")}
            </SectionHeading>
            <Prose>{t.rich("checkoutMethods.custom.body", rich)}</Prose>
            <CodeBlock code={paymentIntentSnippet()} language="typescript" />

            <SectionHeading id={anchor("checkoutSubscriptions")} level={3}>
              {t("checkoutMethods.subscriptions.title")}
            </SectionHeading>
            <Prose>{t.rich("checkoutMethods.subscriptions.body", rich)}</Prose>
            <CodeBlock code={subscriptionApiSnippet()} language="typescript" />

            <ExpectedResult title={t("expected")}>
              <p>{t.rich("checkoutMethods.expected.ok", rich)}</p>
            </ExpectedResult>
          </Section>

          <Section>
            <SectionHeading id={anchor("multipleProviders")} level={2}>
              {t("multipleProviders.title")}
            </SectionHeading>
            <Prose>{t("multipleProviders.lead")}</Prose>
            <Prose>{t("multipleProviders.example")}</Prose>
            <p className="max-w-reading text-body-sm font-medium text-foreground">{t("multipleProviders.notTwice")}</p>
            <FanDiagram
              label={t("multipleProviders.diagram.label")}
              description={t("multipleProviders.diagram.description")}
              top={[
                { key: "installed", label: t("multipleProviders.diagram.installed") },
                { key: "customer", label: t("multipleProviders.diagram.customer"), emphasis: true },
              ]}
              branchesLabel={t("multipleProviders.diagram.branches")}
              branches={(["stripe", "mercado_pago", "abacatepay"] as const).map((id) => ({
                key: id,
                label: CONNECTORS[id].name,
                badge: id === "stripe" ? undefined : t("nav.beta"),
              }))}
              bottom={[{ key: "rule", label: t("multipleProviders.diagram.rule") }]}
            />
            <Prose className="text-caption">{t.rich("multipleProviders.steps", rich)}</Prose>
          </Section>

          <Section>
            <SectionHeading id={anchor("multipleAccounts")} level={2}>
              {t("multipleAccounts.title")}
            </SectionHeading>
            <Prose>{t("multipleAccounts.lead")}</Prose>
            <ul aria-label={t("multipleAccounts.exampleLabel")} className="flex flex-wrap gap-2">
              {(["br", "us"] as const).map((key) => (
                <li
                  key={key}
                  className="inline-flex h-8 items-center rounded-control border border-border bg-surface-1 px-3 text-caption text-foreground"
                >
                  {t(`multipleAccounts.example.${key}`)}
                </li>
              ))}
            </ul>
            <ul className="max-w-reading space-y-1.5">
              {(["workspace", "accounts", "events", "identities"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`multipleAccounts.items.${key}`, rich)}</DetailItem>
              ))}
            </ul>
          </Section>

          <Section>
            <SectionHeading id={anchor("betaProviders")} level={2} badge={<StatusPill tone="beta">{t("nav.beta")}</StatusPill>}>
              {t("betaProviders.title")}
            </SectionHeading>
            <Prose>{t.rich("betaProviders.lead", rich)}</Prose>
            <Callout tone="warning" title={t("betaProviders.meaningTitle")}>
              {t("betaProviders.meaning")}
            </Callout>
            <DefinitionTable
              label={t("betaProviders.title")}
              head={[t("betaProviders.head.provider"), t("betaProviders.head.connect"), t("betaProviders.head.webhook")]}
              rows={BETA_CONNECTORS.map((id) => [
                <a key="name" href={`${betaGuide}#${BETA_PROVIDER_ANCHORS[id]}`} className={textLink}>
                  {CONNECTORS[id].name}
                </a>,
                t(`betaProviders.rows.${id}.connect`),
                t(`betaProviders.rows.${id}.webhook`),
              ])}
            />
            <p className="text-caption">
              <a href={betaGuide} className={textLink}>
                {t("betaProviders.guide")}
              </a>
            </p>
          </Section>

          {/* Concepts */}
          <Section>
            <SectionHeading id={anchor("attribution")} level={2}>
              {t("attribution.title")}
            </SectionHeading>
            <Prose>{t("attribution.lead")}</Prose>
            <FactList
              rows={(["starts", "binds", "pays", "config"] as const).map((key) => [
                t(`attribution.facts.${key}`),
                t.rich(`attribution.facts.${key}Value`, rich),
              ])}
            />

            <SectionHeading id={anchor("attributionWindow")} level={3}>
              {t("attribution.windowTitle")}
            </SectionHeading>
            <Prose>{t.rich("attribution.windowBody", rich)}</Prose>
            <Timeline
              label={t("attribution.timelineLabel")}
              items={(["click", "signup", "payment", "renewal"] as const).map((key) => ({
                key,
                when: t(`attribution.timeline.${key}.when`),
                title: t.rich(`attribution.timeline.${key}.title`, rich),
                note: t.rich(`attribution.timeline.${key}.note`, rich),
                muted: key === "renewal",
              }))}
            />
            <Prose className="text-caption">{t.rich("attribution.windowNote", rich)}</Prose>

            <div className="space-y-4 pt-4">
              <h3 className="text-title text-foreground">{t("attribution.modelsTitle")}</h3>
              <Prose>{t("attribution.modelsLead")}</Prose>
              <Timeline
                label={t("attribution.scenarioLabel")}
                items={(["a", "b"] as const).map((key) => ({
                  key,
                  when: t(`attribution.scenario.${key}.when`),
                  title: t(`attribution.scenario.${key}.title`),
                }))}
              />
              <div className="grid gap-3 md:grid-cols-2">
                {(["firstClick", "lastClick"] as const).map((key) => (
                  <div key={key} className="space-y-2 rounded-panel border border-border bg-surface-1 p-4">
                    <SectionHeading id={anchor(key)} level={3} className="pt-0 text-ui font-medium">
                      {t(`attribution.${key}Title`)}
                    </SectionHeading>
                    <p className="text-caption font-medium text-foreground">{t(`attribution.${key}Result`)}</p>
                    <p className="text-caption text-foreground-secondary">{t(`attribution.${key}Body`)}</p>
                  </div>
                ))}
              </div>
              <Callout tone="info" title={t("attribution.lockTitle")}>
                {t("attribution.lockBody")}
              </Callout>
            </div>

            {/* Official rule, confirmed in code (PROGRAM_PAUSE_SEMANTICS.md):
                tracking.ts gates new attributions on an active program; the
                commission engine has no program-status gate. */}
            <SectionHeading id={anchor("programPause")} level={3}>
              {t("attribution.pause.title")}
            </SectionHeading>
            <Prose>{t("attribution.pause.lead")}</Prose>
            <ul className="max-w-reading space-y-1.5">
              {(["clicks", "before", "customers", "archived"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`attribution.pause.items.${key}`, rich)}</DetailItem>
              ))}
            </ul>
          </Section>

          <Section>
            <SectionHeading id={anchor("identityConcepts")} level={2}>
              {t("identityConcepts.title")}
            </SectionHeading>
            <Prose>{t("identityConcepts.lead")}</Prose>
            <DefinitionTable
              label={t("identityConcepts.title")}
              head={[t("identityConcepts.head.concept"), t("identityConcepts.head.what"), t("identityConcepts.head.from")]}
              rows={(["customer", "billing"] as const).map((key) => [
                <span key="name" className="font-medium text-foreground">
                  {t(`identityConcepts.${key}.name`)}
                </span>,
                t.rich(`identityConcepts.${key}.what`, rich),
                t.rich(`identityConcepts.${key}.from`, rich),
              ])}
            />
            <Prose className="text-caption">{t.rich("identityConcepts.note", rich)}</Prose>
          </Section>

          {/* Step 4 — commission */}
          <Section>
            <SectionHeading id={anchor("commission")} level={2}>
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
              <CodeBlock code={commissionText()} language="text" filename="commissions" />
              <ul className="max-w-reading space-y-1.5 pt-2">
                <DetailItem>
                  {t.rich("commission.units.money", {
                    ...rich,
                    minor: String(COMMISSION_EXAMPLE.baseMinor),
                    amount: f.money(COMMISSION_EXAMPLE.baseMinor, currency),
                  })}
                </DetailItem>
                <DetailItem>
                  {t.rich("commission.units.rate", {
                    ...rich,
                    bps: String(COMMISSION_EXAMPLE.rateBps),
                    rate: f.basisPoints(COMMISSION_EXAMPLE.rateBps),
                  })}
                </DetailItem>
                <DetailItem>{t.rich("commission.units.rounding", rich)}</DetailItem>
                <DetailItem>{t.rich("commission.units.fixed", rich)}</DetailItem>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("commission.conditionsTitle")}</p>
              <ul className="max-w-reading space-y-1.5">
                {(["approved", "currency", "amount", "window", "duration"] as const).map((key) => (
                  <DetailItem key={key}>{t.rich(`commission.conditions.${key}`, { ...rich, a: attributionWindowLink })}</DetailItem>
                ))}
              </ul>
            </div>

            <SectionHeading id={anchor("commissionLifecycle")} level={3}>
              {t("commission.lifecycleTitle")}
            </SectionHeading>
            <div className="space-y-3 rounded-panel border border-border bg-surface-1 p-4">
              <StateFlow
                label={t("commission.flowLabel")}
                states={(["pending", "available", "approved", "paid"] as const).map((key) => ({
                  key,
                  label: t(`commission.states.${key}`),
                  tone: key === "paid" ? ("end" as const) : ("neutral" as const),
                }))}
              />
              <StateFlow
                label={t("commission.refundFlowLabel")}
                states={[
                  { key: "refund", label: t("commission.states.refund") },
                  { key: "reversed", label: t("commission.states.reversed"), tone: "end" },
                ]}
              />
            </div>
            <ul className="max-w-reading space-y-2">
              {(["pending", "available", "approved", "paid", "reversed"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`commission.lifecycle.${key}`, { ...rich, a: holdPeriodLink })}</DetailItem>
              ))}
            </ul>
          </Section>

          <Section>
            <SectionHeading id={anchor("refunds")} level={2}>
              {t("refunds.title")}
            </SectionHeading>
            <Prose>{t("refunds.lead")}</Prose>
            <DefinitionTable
              label={t("refunds.title")}
              head={[t("refunds.head.event"), t("refunds.head.result")]}
              rows={(["full", "partial", "dispute", "disputeWon"] as const).map((key) => [
                <span key="event" className="font-medium text-foreground">
                  {t(`refunds.rows.${key}.event`)}
                </span>,
                t.rich(`refunds.rows.${key}.result`, rich),
              ])}
            />
            <Callout tone="warning" title={t("refunds.paidTitle")}>
              {t.rich("refunds.paidBody", rich)}
            </Callout>
            <Prose className="text-caption">{t.rich("refunds.providers", { ...rich, a: (chunks) => <a href={betaGuide} className={textLink}>{chunks}</a> })}</Prose>
          </Section>

          <Section>
            <SectionHeading id={anchor("holdPeriod")} level={2}>
              {t("holdPeriod.title")}
            </SectionHeading>
            <Prose>{t("holdPeriod.body")}</Prose>
            <DefinitionTable
              label={t("holdPeriod.compareLabel")}
              head={["", t("holdPeriod.head.window"), t("holdPeriod.head.hold")]}
              rows={(["controls", "starts", "defaults", "after"] as const).map((row) => [
                <span key="label" className="text-muted-foreground">
                  {t(`holdPeriod.rows.${row}.label`)}
                </span>,
                t.rich(`holdPeriod.rows.${row}.window`, rich),
                t.rich(`holdPeriod.rows.${row}.hold`, rich),
              ])}
            />
          </Section>

          {/* Reference */}
          <Section>
            <SectionHeading id={anchor("identifyApi")} level={2}>
              {t("identifyApi.title")}
            </SectionHeading>
            <CodeBlock code={identifyEndpoint(app)} language="text" title={t("identifyApi.endpoint")} />
            <FactList
              rows={[
                [t("identifyApi.auth"), t.rich("identifyApi.authValue", rich)],
                [t("identifyApi.contentType"), <InlineCode key="ct">application/json</InlineCode>],
                [t("identifyApi.body"), t.rich("identifyApi.bodyValue", { ...rich, a: fieldsLink })],
                [t("identifyApi.response"), t.rich("identifyApi.responseValue", { ...rich, a: responseLink })],
                [t("identifyApi.rateLimit"), t.rich("identifyApi.rateLimitValue", { ...rich, count: IDENTIFY_RATE_LIMIT })],
                [t("identifyApi.cors"), t("identifyApi.corsValue")],
                [t("identifyApi.idempotency"), t.rich("identifyApi.idempotencyValue", rich)],
              ]}
            />
          </Section>

          <Section>
            <SectionHeading id={anchor("checkoutBridge")} level={2}>
              {t("checkoutBridge.title")}
            </SectionHeading>
            <Prose>{t("checkoutBridge.lead")}</Prose>
            <DefinitionTable
              label={t("checkoutBridge.title")}
              head={[t("checkoutBridge.head.provider"), t("checkoutBridge.head.token"), t("checkoutBridge.head.customer")]}
              rows={CONNECTOR_IDS.map((id) => {
                const fields = bridgeFieldNames(id)
                return [
                  <span key="name" className="inline-flex items-center gap-2">
                    {CONNECTORS[id].name}
                    {id !== "stripe" ? <StatusPill tone="beta">{t("nav.beta")}</StatusPill> : null}
                  </span>,
                  <InlineCode key="token">{fields.token}</InlineCode>,
                  fields.customer ? <InlineCode key="customer">{fields.customer}</InlineCode> : t("checkoutBridge.identifyInstead"),
                ]
              })}
            />
            <Prose className="text-caption">{t("checkoutBridge.where")}</Prose>
            <CodeBlock code={checkoutBridgeSnippet("stripe")} language="typescript" title={t("checkoutBridge.exampleTitle")} />
            <Prose className="text-caption">{t("checkoutBridge.betaNote")}</Prose>
          </Section>

          <Section>
            <SectionHeading id={anchor("webhookEvents")} level={2}>
              {t("webhookEvents.title")}
            </SectionHeading>
            <Prose>{t.rich("webhookEvents.lead", rich)}</Prose>
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
            {ERROR_GROUPS.map((group) => (
              <div key={group.key} className="space-y-2 pt-2">
                <h3 className="text-ui font-medium text-foreground">{t.rich(`errors.groups.${group.key}.title`, rich)}</h3>
                <Prose className="text-caption">{t.rich(`errors.groups.${group.key}.lead`, rich)}</Prose>
                <DefinitionTable
                  label={t(`errors.groups.${group.key}.label`)}
                  head={[t("errors.code"), t("errors.status"), t("errors.cause"), t("errors.fix")]}
                  rows={group.codes.map(([code, status]) => [
                    code === "no_content" ? (
                      <span key="code" className="text-muted-foreground">
                        {t("errors.noBody")}
                      </span>
                    ) : (
                      <InlineCode key="code">{RESPONSE_LABEL[code] ?? code}</InlineCode>
                    ),
                    <span key="status" className="font-mono tabular-nums text-muted-foreground">
                      {status}
                    </span>,
                    t.rich(`errors.groups.${group.key}.items.${code}.cause`, rich),
                    t.rich(`errors.groups.${group.key}.items.${code}.fix`, rich),
                  ])}
                />
              </div>
            ))}
          </Section>

          {/* Step 5 — verify */}
          <Section>
            <SectionHeading id={anchor("verify")} level={2}>
              {t("verify.title")}
            </SectionHeading>
            <Prose>{t.rich("verify.lead", rich)}</Prose>
            <Steps
              label={t("verify.checklistLabel")}
              items={(["click", "identify", "webhook", "commission"] as const).map((key) => ({
                key,
                title: t(`verify.steps.${key}.title`),
                body: (
                  <>
                    <p>
                      <span className="text-muted-foreground">{t("verify.where")} </span>
                      {t.rich(`verify.steps.${key}.where`, rich)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("verify.ifNot")} </span>
                      {t.rich(`verify.steps.${key}.ifNot`, rich)}
                    </p>
                  </>
                ),
              }))}
            />
            <Callout tone="success" title={t("verify.doneTitle")}>
              {t("verify.doneBody")}
            </Callout>
          </Section>

          <Section>
            <SectionHeading id={anchor("integrationHealth")} level={2}>
              {t("integrationHealth.title")}
            </SectionHeading>
            <Prose>{t("integrationHealth.lead")}</Prose>
            <DefinitionTable
              label={t("integrationHealth.statesLabel")}
              head={[t("integrationHealth.head.state"), t("integrationHealth.head.meaning"), t("integrationHealth.head.action")]}
              rows={(["healthy", "setupIncomplete", "configuring", "awaiting", "degraded", "actionRequired", "error", "disconnected"] as const).map((key) => [
                <span key="state" className="inline-flex items-center gap-2 text-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      key === "healthy"
                        ? "bg-success"
                        : key === "configuring" || key === "degraded" || key === "setupIncomplete"
                          ? "bg-warning"
                          : key === "actionRequired" || key === "error"
                            ? "bg-danger"
                            : "bg-faint-foreground",
                    )}
                  />
                  {t(`integrationHealth.states.${key}.name`)}
                </span>,
                t(`integrationHealth.states.${key}.meaning`),
                t(`integrationHealth.states.${key}.action`),
              ])}
            />
            <Callout tone="info" title={t("integrationHealth.notErrorTitle")}>
              {t("integrationHealth.notErrorBody")}
            </Callout>

            <SectionHeading id={anchor("advancedDiagnostics")} level={3}>
              {t("integrationHealth.advancedTitle")}
            </SectionHeading>
            <Prose>{t("integrationHealth.advancedLead")}</Prose>
            <DefinitionTable
              label={t("integrationHealth.advancedTitle")}
              head={[t("integrationHealth.head.object"), t("integrationHealth.head.what")]}
              rows={(["attribution", "customer", "billingIdentity", "billingEvent", "transaction", "commission"] as const).map((key) => [
                <span key="name" className="whitespace-nowrap font-mono text-meta text-foreground">
                  {t(`integrationHealth.objects.${key}.name`)}
                </span>,
                t.rich(`integrationHealth.objects.${key}.what`, rich),
              ])}
            />
          </Section>

          <Section>
            <SectionHeading id={anchor("missingCommission")} level={2}>
              {t("missingCommission.title")}
            </SectionHeading>
            <Prose>{t.rich("missingCommission.lead", rich)}</Prose>
            <ol className="max-w-reading list-decimal space-y-1.5 pl-5 text-body-sm text-foreground-secondary">
              {(["referral", "customer", "payment", "recognised", "eligible", "commission"] as const).map((key) => (
                <li key={key}>{t.rich(`missingCommission.steps.${key}`, rich)}</li>
              ))}
            </ol>
            <Callout tone="info" title={t("missingCommission.organicTitle")}>
              {t.rich("missingCommission.organic", rich)}
            </Callout>
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("missingCommission.whyTitle")}</p>
              <ul className="max-w-reading space-y-1.5">
                {(["expired", "affiliate", "environment", "currency", "duration", "recognised", "program"] as const).map((key) => (
                  <DetailItem key={key}>{t.rich(`missingCommission.why.${key}`, { ...rich, a: anchorLink("programPause") })}</DetailItem>
                ))}
              </ul>
            </div>
            <Prose className="text-caption">{t.rich("missingCommission.reasonsLead", rich)}</Prose>
            <DefinitionTable
              label={t("missingCommission.reasonsTitle")}
              head={[t("missingCommission.head.code"), t("missingCommission.head.meaning")]}
              rows={DOCUMENTED_REASONS.map((code) => [<InlineCode key="code">{code}</InlineCode>, tReasons(code)])}
            />
          </Section>

          <Section>
            <SectionHeading id={anchor("providerCredentials")} level={2}>
              {t("providerCredentials.title")}
            </SectionHeading>
            <Prose>{t("providerCredentials.lead")}</Prose>
            <ul className="max-w-reading space-y-1.5">
              {(["stripe", "encrypted", "dedicated", "secrets", "disconnect"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`providerCredentials.items.${key}`, rich)}</DetailItem>
              ))}
            </ul>
          </Section>

          <Section>
            <SectionHeading id={anchor("apiKeys")} level={2}>
              {t("apiKeys.title")}
            </SectionHeading>
            <Prose>{t("apiKeys.lead")}</Prose>
            <div className="grid gap-3 md:grid-cols-2">
              <KeyCard
                icon={Globe}
                title={t("apiKeys.publishable.title")}
                sample="pk_test_… · pk_live_…"
                where={t("apiKeys.publishable.where")}
                uses={[t.rich("apiKeys.publishable.uses.tracker", rich), t("apiKeys.publishable.uses.clicks")]}
              />
              <KeyCard
                icon={Lock}
                title={t("apiKeys.secret.title")}
                sample="sk_test_… · sk_live_…"
                where={t("apiKeys.secret.where")}
                uses={[t.rich("apiKeys.secret.uses.identify", rich), t("apiKeys.secret.uses.env")]}
                danger
              />
            </div>
            <Callout tone="danger" title={t("apiKeys.exposeTitle")}>
              {t.rich("apiKeys.exposeBody", rich)}
            </Callout>
            <ul className="max-w-reading space-y-1.5">
              {(["generate", "once", "rotate"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`apiKeys.facts.${key}`, rich)}</DetailItem>
              ))}
            </ul>
          </Section>

          <Section>
            <SectionHeading id={anchor("webhookSecurity")} level={2}>
              {t("webhookSecurity.title")}
            </SectionHeading>
            <Prose>{t("webhookSecurity.lead")}</Prose>
            <ul className="max-w-reading space-y-1.5">
              {(["verified", "rejected", "once", "environment", "token", "customer"] as const).map((key) => (
                <DetailItem key={key}>{t.rich(`webhookSecurity.items.${key}`, rich)}</DetailItem>
              ))}
            </ul>
          </Section>

          {/* Security */}
          <Section>
            <SectionHeading id={anchor("environments")} level={2}>
              {t("environments.title")}
            </SectionHeading>
            <Prose>{t.rich("environments.lead", rich)}</Prose>
            <DefinitionTable
              label={t("environments.title")}
              head={[t("environments.head.what"), t("environments.head.test"), t("environments.head.live")]}
              rows={(["use", "keys", "programs", "stripe", "dashboard", "plan"] as const).map((row) => [
                <span key="label" className="text-muted-foreground">
                  {t(`environments.rows.${row}.label`)}
                </span>,
                t.rich(`environments.rows.${row}.test`, rich),
                t.rich(`environments.rows.${row}.live`, rich),
              ])}
            />
            <div className="space-y-2">
              <p className="text-caption font-medium text-foreground">{t("environments.withoutLiveTitle")}</p>
              <ul className="max-w-reading space-y-1.5">
                {(["track", "identify", "webhook"] as const).map((key) => (
                  <DetailItem key={key}>{t.rich(`environments.withoutLive.${key}`, rich)}</DetailItem>
                ))}
              </ul>
            </div>
            <Callout tone="success" title={t("environments.simulateTitle")}>
              {t("environments.simulateBody")}
            </Callout>

            <SectionHeading id={anchor("goLive")} level={3}>
              {t("environments.goLiveTitle")}
            </SectionHeading>
            <Steps
              label={t("environments.goLiveTitle")}
              items={(["plan", "program", "keys", "swap", "stripe", "validate"] as const).map((key) => ({
                key,
                title: t(`environments.goLive.${key}.title`),
                body: (
                  <p>
                    {t.rich(`environments.goLive.${key}.body`, {
                      ...rich,
                      pricing: (chunks) => (
                        <Link href="/pricing" className={textLink}>
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                ),
              }))}
            />
          </Section>
        </article>
      </main>

      <aside className="hidden xl:block">
        <div data-slot="scrollable" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-6">
          <DocsToc title={t("nav.onThisPage")} groups={toc} />
        </div>
      </aside>
    </div>
  )
}

function DetailItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-body-sm text-foreground-secondary">
      {/* 24px line box: the 4px dot sits on the x-height centre. */}
      <span className="flex h-6 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="size-1 rounded-full bg-faint-foreground" />
      </span>
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
