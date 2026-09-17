"use client"

import { ArrowUpRight, Check, Loader2, TriangleAlert } from "lucide-react"
import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useEffect, useState, useTransition } from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { MetricCell, MetricGrid } from "@/components/data-display/metric"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { StatusBadge, StatusDot } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useActionResult } from "@/components/ui/use-action-result"
import { useRouter } from "@/i18n/navigation"
import { STRIPE_HANDLED_EVENTS, STRIPE_WEBHOOK_SECRET_PREFIX } from "@/lib/billing/stripe/events"
import { cn } from "@/lib/utils"

import {
  disconnectStripeAction,
  saveStripeSecretAction,
  startStripeAction,
  type IntegrationFormState,
} from "./actions"
import { CodeField } from "./code-field"
import { needsSetup, stripeBadgeStatus, type StripeConnectionState } from "./stripe-status"

const INITIAL: IntegrationFormState = {}
const SECRET_ENVIRONMENTS = ["test", "live"] as const
export type SecretEnvironment = (typeof SECRET_ENVIRONMENTS)[number]

export interface EnvironmentEvidence {
  /** "há 5 minutos", or `null` when nothing arrived in this mode. */
  when: string | null
  type: string | null
  failed: boolean
  /** `false` when derived from the latest recorded payment rather than from the event itself. */
  exact: boolean
}

export interface StripePanelProps {
  workspaceSlug: string
  state: StripeConnectionState
  providerAccountId: string | null
  /** Which endpoint signing secrets are stored: the Stripe test-mode endpoint's and the live one's. */
  secrets: Record<SecretEnvironment, boolean>
  /** Latest evidence per Stripe mode, pre-formatted on the server. */
  environments: Record<SecretEnvironment, EnvironmentEvidence>
  /** Whether live events are processed on this plan; `false` shows why they are not. */
  liveModeAvailable: boolean
  /** This integration's own endpoint; `null` until step 1 has created the integration. */
  webhookUrl: string | null
  /** Pre-formatted on the server ("há 5 minutos") so server and client agree. */
  lastEvent: { when: string; type: string } | null
  lastRejectedWhen: string | null
  /** A `member`: status only — setup and disconnecting are admin actions. */
  readOnly?: boolean
}

const code = (chunks: React.ReactNode) => <code className="font-mono text-meta">{chunks}</code>
const strong = (chunks: React.ReactNode) => <strong className="font-medium text-foreground">{chunks}</strong>

export function StripePanel(props: StripePanelProps) {
  const { state, readOnly = false } = props
  const t = useTranslations("forms.stripe")
  const badge = stripeBadgeStatus(state)
  // Called from a confirmation dialog, which closes when the action settles.
  // Held here because disconnecting swaps the summary for the setup steps, and
  // the outcome has to survive that swap.
  const [disconnectState, setDisconnectState] = useState<IntegrationFormState>(INITIAL)
  const disconnect = async (formData: FormData) =>
    setDisconnectState(await disconnectStripeAction(INITIAL, formData))

  return (
    <section>
      <SectionHeader
        title={t("title")}
        count={badge ? <StatusBadge status={badge} label={t(`badge.${state}`)} /> : undefined}
        description={t("description")}
        className="mb-3"
      />

      {disconnectState.success && needsSetup(state) ? (
        <InlineAlert tone="success" className="mb-3">
          {disconnectState.success}
        </InlineAlert>
      ) : null}

      {needsSetup(state) ? (
        readOnly ? (
          state === "awaitingFirstEvent" ? (
            <HealthAlert {...props} />
          ) : (
            <InlineAlert>{state === "notStarted" ? t("adminOnly") : t("memberSetupPending")}</InlineAlert>
          )
        ) : (
          <SetupWizard {...props} onDisconnect={disconnect} disconnectError={disconnectState.error} />
        )
      ) : (
        <ConnectedSummary {...props} onDisconnect={disconnect} disconnectError={disconnectState.error} />
      )}
    </section>
  )
}

/** What the evidence says, in one sentence: waiting, receiving, or why it failed. */
function HealthAlert({ state, lastEvent, lastRejectedWhen }: StripePanelProps) {
  const t = useTranslations("forms.stripe.health")

  switch (state) {
    case "awaitingFirstEvent":
      return <InlineAlert title={t("awaitingTitle")}>{t("awaitingBody")}</InlineAlert>
    case "receiving":
      return lastEvent ? (
        <InlineAlert tone="success" title={t("receivingTitle", { when: lastEvent.when })}>
          {t.rich("receivingBody", { type: lastEvent.type, code })}
        </InlineAlert>
      ) : null
    case "lastEventFailed":
      return lastEvent ? (
        <InlineAlert tone="danger" title={t("failedTitle")}>
          {t.rich("failedBody", { type: lastEvent.type, when: lastEvent.when, code })}
        </InlineAlert>
      ) : null
    case "signatureRejected":
      return (
        <InlineAlert tone="danger" title={t("rejectedTitle")}>
          {t("rejectedBody", { when: lastRejectedWhen ?? "" })}
        </InlineAlert>
      )
    case "error":
      return (
        <InlineAlert tone="danger" title={t("errorTitle")}>
          {t("errorBody")}
        </InlineAlert>
      )
    default:
      return null
  }
}

/** Stripe's webhooks page in test mode — where step 2 happens. Not copy, never translated. */
const STRIPE_WEBHOOKS_URL = "https://dashboard.stripe.com/test/webhooks"
const STEP_COUNT = 4
/** How often the last step re-reads the page while it waits for the first event. */
const VERIFY_POLL_MS = 15_000

const EVENT_GROUPS = {
  payments: ["payment", "oneOffPayment", "paymentLink"],
  refunds: ["refund", "chargeback"],
  subscriptions: ["subscription", "subscriptionCancelled"],
} as const satisfies Record<string, ReadonlyArray<(typeof STRIPE_HANDLED_EVENTS)[number]["records"]>>

/** The event names to tick in Stripe, grouped by what they record. Identifiers, never translated. */
function EventList() {
  const t = useTranslations("forms.stripe.steps.webhook")
  return (
    <div className="space-y-2.5">
      {(Object.keys(EVENT_GROUPS) as Array<keyof typeof EVENT_GROUPS>).map((group) => (
        <div key={group} className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline">
          <p className="text-meta text-muted-foreground">{t(`groups.${group}`)}</p>
          <ul className="flex flex-wrap gap-1.5">
            {STRIPE_HANDLED_EVENTS.filter((event) =>
              (EVENT_GROUPS[group] as ReadonlyArray<string>).includes(event.records),
            ).map((event) => (
              <li
                key={event.type}
                className="inline-flex h-5 items-center rounded-badge border border-border bg-fill-subtle px-1.5 font-mono text-meta text-foreground-secondary"
              >
                {event.type}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Stripe only delivers to public HTTPS endpoints; say so before the reader finds out the hard way. */
function isInsecureUrl(url: string): boolean {
  return url.startsWith("http://")
}

// ---------------------------------------------------------------------------
// Setup: four steps, one open at a time. Step 1 creates the integration, which
// gives step 2 a URL; step 3 stores a signing secret; step 4 waits for the
// first event, which is what finally swaps the wizard for the summary.
// ---------------------------------------------------------------------------

type SetupWizardProps = StripePanelProps & {
  onDisconnect: (formData: FormData) => Promise<void>
  disconnectError?: string
}

function SetupWizard(props: SetupWizardProps) {
  const { workspaceSlug, state, providerAccountId, webhookUrl, secrets } = props
  const t = useTranslations("forms.stripe")
  const [accountState, saveAccount, savingAccount] = useActionState(startStripeAction, INITIAL)
  // Stripe cannot tell us the endpoint exists, so step 2 is done when the reader says so.
  const [webhookConfirmed, setWebhookConfirmed] = useState(false)
  // A done step reopened for review. Keyed to the step that was current, so it
  // closes by itself once the server moves the wizard on.
  const [review, setReview] = useState<{ step: number; from: number } | null>(null)

  const started = state !== "notStarted" && Boolean(webhookUrl)
  const current = !started ? 1 : state === "awaitingFirstEvent" ? 4 : webhookConfirmed ? 3 : 2
  const open = review && review.from === current ? review.step : current
  const closeReview = () => setReview(null)
  const reviewStep = (step: number) => () => setReview({ step, from: current })
  const statusOf = (step: number) => (step < current ? "done" : step === current ? "current" : "upcoming")

  // The forms show their own outcome inline; no toasts.
  useActionResult(accountState, { onSuccess: closeReview, toastOnSuccess: false, toastOnError: false })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <p className="text-meta text-muted-foreground">{t("steps.progress", { current, total: STEP_COUNT })}</p>
          <div className="flex w-24 gap-1" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span
                key={i}
                className={cn("h-1 flex-1 rounded-full", i + 1 < current ? "bg-foreground" : i + 1 === current ? "bg-foreground-secondary/50" : "bg-border")}
              />
            ))}
          </div>
        </div>

        <ol aria-label={t("steps.label")} className="px-4 py-5 sm:px-5">
          <Step
            index={1}
            status={statusOf(1)}
            open={open === 1}
            title={t("steps.account.title")}
            summary={<span className="font-mono text-meta text-foreground">{providerAccountId}</span>}
            reviewLabel={t("steps.account.edit")}
            onReview={reviewStep(1)}
          >
            <form action={saveAccount} noValidate className="space-y-3">
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <Field label={t("accountId")} htmlFor="providerAccountId" hint={t("accountIdHint")} error={accountState.error}>
                <Input
                  id="providerAccountId"
                  name="providerAccountId"
                  defaultValue={providerAccountId ?? undefined}
                  placeholder={t("accountIdPlaceholder")}
                  className="font-mono sm:max-w-80"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-describedby={accountState.error ? "providerAccountId-error" : "providerAccountId-hint"}
                  invalid={Boolean(accountState.error)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="sm" loading={savingAccount}>
                  {started ? t("steps.account.save") : t("steps.account.submit")}
                </Button>
                {started ? (
                  <Button type="button" variant="ghost" size="sm" onClick={closeReview}>
                    {t("cancel")}
                  </Button>
                ) : null}
              </div>
            </form>
          </Step>

          <Step
            index={2}
            status={statusOf(2)}
            open={open === 2}
            title={t("steps.webhook.title")}
            summary={<span className="text-meta text-muted-foreground">{t("steps.webhook.summary")}</span>}
            reviewLabel={t("steps.review")}
            onReview={reviewStep(2)}
          >
            {webhookUrl ? (
              <div className="space-y-4">
                <p className="max-w-prose text-meta text-muted-foreground">
                  {t.rich("steps.webhook.description", { strong })}
                </p>
                <div className="space-y-1.5">
                  <p className="text-meta font-medium text-muted-foreground">{t("webhook")}</p>
                  <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField>
                  {isInsecureUrl(webhookUrl) ? (
                    <p className="flex items-start gap-1.5 text-meta text-warning-foreground">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {t("steps.webhook.httpsWarning")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-meta font-medium text-muted-foreground">{t("steps.webhook.events")}</p>
                    <CopyButton
                      value={STRIPE_HANDLED_EVENTS.map((event) => event.type).join(", ")}
                      label={t("steps.webhook.copyEvents")}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                  <EventList />
                </div>
                <p className="max-w-prose text-meta text-faint-foreground">{t("steps.webhook.modes")}</p>
                <div className="flex flex-wrap gap-2">
                  {current === 2 ? (
                    <Button type="button" variant="primary" size="sm" onClick={() => setWebhookConfirmed(true)}>
                      {t("steps.webhook.confirm")}
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" size="sm" onClick={closeReview}>
                      {t("steps.collapse")}
                    </Button>
                  )}
                  <StripeDashboardLink label={t("steps.webhook.openStripe")} />
                </div>
              </div>
            ) : null}
          </Step>

          <Step
            index={3}
            status={statusOf(3)}
            open={open === 3}
            title={t("steps.secret.title")}
            summary={<SecretSummary secrets={secrets} />}
            reviewLabel={t("steps.review")}
            onReview={reviewStep(3)}
          >
            <div className="space-y-3">
              <p className="max-w-prose text-meta text-muted-foreground">
                {t.rich("steps.secret.description", { strong })}
              </p>
              <SecretTabs
                workspaceSlug={workspaceSlug}
                secrets={secrets}
                liveModeAvailable={props.liveModeAvailable}
                primary={current === 3}
              />
              {current !== 3 ? (
                <Button type="button" variant="ghost" size="sm" onClick={closeReview}>
                  {t("steps.collapse")}
                </Button>
              ) : null}
            </div>
          </Step>

          <Step index={4} status={statusOf(4)} open={open === 4} title={t("steps.verify.title")} last>
            <VerifyStep />
          </Step>
        </ol>
      </Card>

      {current === 4 ? <DisconnectRow {...props} /> : null}
    </div>
  )
}

function Step({
  index,
  status,
  open,
  title,
  summary,
  reviewLabel,
  onReview,
  last = false,
  children,
}: {
  index: number
  status: "done" | "current" | "upcoming"
  open: boolean
  title: string
  /** One line standing in for a done step's content while it is closed. */
  summary?: React.ReactNode
  reviewLabel?: string
  onReview?: () => void
  last?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("forms.stripe.steps")
  const collapsedDone = status === "done" && !open

  return (
    <li aria-current={status === "current" ? "step" : undefined} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      {/* The rail: a marker, then a hairline down to the next step. */}
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-meta",
            status === "done" && "border-border-strong bg-fill-subtle text-foreground",
            status === "current" && "border-foreground text-foreground",
            status === "upcoming" && "border-border text-faint-foreground",
          )}
        >
          {status === "done" ? <Check className="size-3.5" /> : index}
        </span>
        {last ? null : <span aria-hidden="true" className="my-1.5 w-px flex-1 bg-border" />}
      </div>

      <div className={cn("min-w-0", !last && "pb-6")}>
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className={cn("text-caption font-medium", status === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
            <span className="sr-only">{t("status", { index, status })} </span>
            {title}
          </h3>
          {collapsedDone && onReview && reviewLabel ? (
            <Button type="button" variant="ghost" size="xs" onClick={onReview}>
              {reviewLabel}
            </Button>
          ) : null}
        </div>
        {collapsedDone && summary ? <div className="mt-1">{summary}</div> : null}
        {open ? <div className="mt-3 animate-fade-in">{children}</div> : null}
      </div>
    </li>
  )
}

function StripeDashboardLink({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={STRIPE_WEBHOOKS_URL} target="_blank" rel="noreferrer">
        {label}
        <ArrowUpRight aria-hidden="true" />
      </a>
    </Button>
  )
}

/** Step 4: re-reads the page while visible, so the wizard completes when the first event lands. */
function VerifyStep() {
  const t = useTranslations("forms.stripe.steps")
  const router = useRouter()
  const [checking, startChecking] = useTransition()

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") startChecking(() => router.refresh())
    }, VERIFY_POLL_MS)
    return () => clearInterval(timer)
  }, [router])

  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-2 text-caption text-foreground">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        {t("verify.waiting")}
      </p>
      <p className="max-w-prose text-meta text-muted-foreground">{t.rich("verify.body", { code })}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={checking}
          onClick={() => startChecking(() => router.refresh())}
        >
          {t("verify.checkNow")}
        </Button>
        <StripeDashboardLink label={t("webhook.openStripe")} />
      </div>
    </div>
  )
}

/** "Test · saved   Live · not saved", for a closed step 3. */
function SecretSummary({ secrets }: { secrets: Record<SecretEnvironment, boolean> }) {
  const t = useTranslations("forms.stripe")
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {SECRET_ENVIRONMENTS.map((environment) => (
        <li key={environment} className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <StatusDot tone={secrets[environment] ? "success" : "neutral"} />
          {t(`secretEnvironments.${environment}.tab`)} · {t(secrets[environment] ? "secretStatus.saved" : "secretStatus.missing")}
        </li>
      ))}
    </ul>
  )
}

/** Test and live side by side as tabs: one field at a time, each mode's status on its tab. */
function SecretTabs({
  workspaceSlug,
  secrets,
  liveModeAvailable,
  primary = false,
}: {
  workspaceSlug: string
  secrets: Record<SecretEnvironment, boolean>
  liveModeAvailable: boolean
  /** The view's one primary action (the setup wizard's current step). */
  primary?: boolean
}) {
  const t = useTranslations("forms.stripe")
  // Open where there is something to do: test unless only test is already saved.
  const initial: SecretEnvironment = secrets.test && !secrets.live ? "live" : "test"

  return (
    <Tabs defaultValue={initial}>
      <TabsList>
        {SECRET_ENVIRONMENTS.map((environment) => (
          <TabsTrigger key={environment} value={environment}>
            <StatusDot tone={secrets[environment] ? "success" : "neutral"} />
            {t(`secretEnvironments.${environment}.tab`)}
            <span className="sr-only">
              {" · "}
              {t(secrets[environment] ? "secretStatus.saved" : "secretStatus.missing")}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
      {SECRET_ENVIRONMENTS.map((environment) => (
        <TabsContent key={environment} value={environment} className="pt-4">
          <SecretSlot
            workspaceSlug={workspaceSlug}
            environment={environment}
            saved={secrets[environment]}
            liveModeAvailable={liveModeAvailable}
            primary={primary}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

/**
 * One endpoint's signing secret: saved state, then a form to save or replace
 * it. Test and live are independent — replacing one never touches the other.
 */
function SecretSlot({
  workspaceSlug,
  environment,
  saved,
  liveModeAvailable,
  primary = false,
}: {
  workspaceSlug: string
  environment: SecretEnvironment
  saved: boolean
  liveModeAvailable: boolean
  primary?: boolean
}) {
  const t = useTranslations("forms.stripe")
  const [state, save, saving] = useActionState(saveStripeSecretAction, INITIAL)
  const [editing, setEditing] = useState(false)
  useActionResult(state, { onSuccess: () => setEditing(false), toastOnSuccess: false, toastOnError: false })
  const open = editing || !saved

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-meta text-muted-foreground">{t(`secretEnvironments.${environment}.hint`)}</p>
      {environment === "live" && !liveModeAvailable ? (
        <InlineAlert>{t("liveNeedsPlan")}</InlineAlert>
      ) : null}
      {saved && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-fill-subtle px-3 py-2 sm:max-w-md">
          <p className="flex items-center gap-1.5 text-caption text-foreground">
            <Check className="size-3.5 text-success-foreground" aria-hidden="true" />
            {t("secretSaved")}
          </p>
          <Button type="button" variant="secondary" size="xs" onClick={() => setEditing(true)}>
            {t("replaceSecret")}
          </Button>
        </div>
      ) : null}
      {state.success && !open ? <InlineAlert tone="success">{state.success}</InlineAlert> : null}
      {open ? (
        <SecretForm
          workspaceSlug={workspaceSlug}
          environment={environment}
          action={save}
          pending={saving}
          error={state.error}
          primary={primary}
          onCancel={saved ? () => setEditing(false) : undefined}
        />
      ) : null}
    </div>
  )
}

function SecretForm({
  workspaceSlug,
  environment,
  action,
  pending,
  error,
  primary = false,
  onCancel,
}: {
  workspaceSlug: string
  environment: SecretEnvironment
  action: (formData: FormData) => void
  pending: boolean
  error?: string
  primary?: boolean
  onCancel?: () => void
}) {
  const t = useTranslations("forms.stripe")
  const id = `webhookSecret-${environment}`
  const [value, setValue] = useState("")
  // Caught while typing; the server action still validates the whole shape.
  const wrongPrefix =
    value.length >= STRIPE_WEBHOOK_SECRET_PREFIX.length && !value.startsWith(STRIPE_WEBHOOK_SECRET_PREFIX)
  const shownError = error ?? (wrongPrefix ? t("secretPrefix") : undefined)

  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="environment" value={environment} />
      <Field label={t("secret")} htmlFor={id} hint={t("secretHint")} error={shownError}>
        {/* A password field: the secret is never shown back, and not echoed on screen while typed. */}
        <Input
          id={id}
          name="webhookSecret"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value.trim())}
          placeholder={t("secretPlaceholder")}
          className="font-mono sm:max-w-md"
          autoComplete="off"
          spellCheck={false}
          required
          aria-describedby={shownError ? `${id}-error` : `${id}-hint`}
          invalid={Boolean(shownError)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={primary ? "primary" : "secondary"}
          size="sm"
          loading={pending}
          disabled={!value || wrongPrefix}
        >
          {t("saveSecret")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** The latest event of each Stripe mode, one line each. */
function EnvironmentEvidenceList({ environments }: { environments: Record<SecretEnvironment, EnvironmentEvidence> }) {
  const t = useTranslations("forms.stripe.evidence")
  return (
    <ul className="space-y-1">
      {SECRET_ENVIRONMENTS.map((environment) => {
        const evidence = environments[environment]
        return (
          <li key={environment} className="text-meta text-muted-foreground">
            {evidence.when ? (
              <>
                {t(evidence.failed ? "failed" : evidence.exact ? "lastEvent" : "lastRecorded", {
                  environment,
                  when: evidence.when,
                })}
                {evidence.type ? (
                  <>
                    {" · "}
                    <code className="font-mono text-meta">{evidence.type}</code>
                  </>
                ) : null}
              </>
            ) : (
              t("none", { environment })
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Configured: evidence first, then the facts, then the one destructive action.
// ---------------------------------------------------------------------------

function ConnectedSummary(
  props: StripePanelProps & {
    onDisconnect: (formData: FormData) => Promise<void>
    disconnectError?: string
  },
) {
  const { workspaceSlug, providerAccountId, webhookUrl, readOnly = false } = props
  const t = useTranslations("forms.stripe")

  return (
    <div className="space-y-4">
      <HealthAlert {...props} />
      <EnvironmentEvidenceList environments={props.environments} />

      <MetricGrid>
        <MetricCell className="min-w-0">
          <p className="text-caption text-muted-foreground">{t("account")}</p>
          <p className="mt-1 truncate font-mono text-meta text-foreground">{providerAccountId ?? "—"}</p>
        </MetricCell>
        <MetricCell className="col-span-2 min-w-0 max-sm:border-t max-sm:border-border-faint">
          <p className="mb-1 text-caption text-muted-foreground">{t("webhook")}</p>
          {webhookUrl ? <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField> : null}
        </MetricCell>
      </MetricGrid>

      <div className="space-y-1.5">
        <p className="text-meta font-medium text-muted-foreground">{t("steps.webhook.events")}</p>
        <EventList />
      </div>

      {readOnly ? null : (
        <div className="border-t border-border-faint pt-4">
          <SecretTabs workspaceSlug={workspaceSlug} secrets={props.secrets} liveModeAvailable={props.liveModeAvailable} />
        </div>
      )}

      {readOnly ? null : <DisconnectRow {...props} />}
    </div>
  )
}

/** The one destructive action, apart from everything else. */
function DisconnectRow({
  workspaceSlug,
  onDisconnect,
  disconnectError,
}: {
  workspaceSlug: string
  onDisconnect: (formData: FormData) => Promise<void>
  disconnectError?: string
}) {
  const t = useTranslations("forms.stripe")
  return (
    <div className="space-y-3 border-t border-border-faint pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-meta text-muted-foreground">{t("disconnectHint")}</p>
        <ConfirmDialog
          trigger={t("disconnect")}
          title={t("disconnectTitle")}
          description={t("disconnectBody")}
          confirmLabel={t("disconnectConfirm")}
          action={onDisconnect}
        >
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        </ConfirmDialog>
      </div>
      {disconnectError ? <InlineAlert tone="danger">{disconnectError}</InlineAlert> : null}
    </div>
  )
}
