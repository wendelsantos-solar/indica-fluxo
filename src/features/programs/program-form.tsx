"use client"

import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useRef, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { FormSection } from "@/components/ui/form-section"
import { Input, Select, Textarea } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"
import { SettingsDisclosure } from "@/features/onboarding/settings-disclosure"
import { CURRENCY_CODES, type SelectOption } from "@/features/workspaces/options"

import { createProgramAction, updateProgramAction, type ProgramFormState } from "./actions"
import { DURATION_MONTHS_MAX, DURATION_MONTHS_MIN, WEBSITE_URL_MAX_LENGTH } from "./limits"

const INITIAL: ProgramFormState = {}

export interface ProgramFormValues {
  id?: string
  name: string
  description: string
  /**
   * The product's site. Omitted by a caller that does not load it, in which
   * case the field is not rendered and saving leaves the stored value alone.
   */
  websiteUrl?: string
  status: "draft" | "active" | "paused" | "archived"
  /** Create only. Fixed at creation (docs/PLANS.md §2), so never on the edit form. */
  environment?: "test" | "live"
  commissionType: "percentage" | "fixed"
  commissionAmount: string
  recurrence: "lifetime" | "first_only" | "months"
  durationMonths: string
  attributionModel: "first_click" | "last_click"
  attributionWindowDays: string
  commissionHoldDays: string
  currency: string
}

/** Fields behind "Advanced settings", per variant; an error in one reveals it. */
/** Settings a live program can start from: everything but its identity. */
export type ProgramTemplateValues = Omit<ProgramFormValues, "id" | "name" | "environment">

/**
 * What the create form may offer, decided on the server from the plan
 * (`getPlanOverview`). `createProgram` enforces the same rules; this only keeps
 * a choice that cannot be saved from being offered.
 */
export interface EnvironmentChoice {
  /** A test program fits the plan's limit. */
  test: boolean
  /** A live program fits: live mode included and in good standing, and under the limit. */
  live: boolean
  /** Why live is not offered: the plan has no live mode, or its live limit is reached. */
  liveBlockedBy: "plan" | "limit" | null
  /** Test programs whose settings a new live program can copy. */
  templates: { id: string; name: string; values: ProgramTemplateValues }[]
}

const ADVANCED_FIELDS = {
  full: ["attributionModel", "attributionWindowDays", "commissionHoldDays"],
  onboarding: [
    "websiteUrl",
    "status",
    "currency",
    "attributionModel",
    "attributionWindowDays",
    "commissionHoldDays",
  ],
} as const

/**
 * One form, two shapes.
 *
 * `full` is the dashboard form (create and edit): every group visible except
 * attribution and hold, which sit in a disclosure — collapsed when creating,
 * open when editing, because someone on a settings tab came to change them.
 *
 * `onboarding` asks only what a founder must decide — name, commission and
 * recurrence — and keeps status, currency, attribution and hold behind a
 * collapsed disclosure that echoes their defaults. Every field still submits,
 * so the action's schema receives exactly what it did before. The product site
 * is optional and sits in that disclosure too: affiliates are told where their
 * default link is missing, so onboarding does not have to insist.
 *
 * Editing a program into a non-active status, or to another currency, changes
 * what every affiliate can earn, so saving asks first and says what happens
 * (see `consequences` below — it describes what the services really do).
 */
export function ProgramForm({
  workspaceSlug,
  defaultValues,
  mode,
  variant = "full",
  currencyOptions,
  environmentChoice,
}: {
  workspaceSlug: string
  defaultValues: ProgramFormValues
  mode: "create" | "edit"
  variant?: "full" | "onboarding"
  /**
   * `BRL — Real brasileiro`, built on the server with `currencyOptions(locale)`
   * so `Intl` names cannot differ at hydration. Bare codes without it.
   */
  currencyOptions?: SelectOption[]
  /** Create only, full variant. Without it a new program is a test program. */
  environmentChoice?: EnvironmentChoice
}) {
  const t = useTranslations("forms.program")
  const ts = useTranslations("status")
  const ta = useTranslations("common.actions")
  const [state, action, pending] = useActionState(
    mode === "create" ? createProgramAction : updateProgramAction,
    INITIAL,
  )

  // Controlled, so a failed submission keeps what was typed instead of
  // snapping back to the defaults when React resets the form.
  // A stored duration of 1 month *is* "first payment only", so the months
  // field never starts below its minimum when someone switches to it.
  const [values, setValues] = useState(() => ({
    ...defaultValues,
    durationMonths:
      Number(defaultValues.durationMonths) >= DURATION_MONTHS_MIN
        ? defaultValues.durationMonths
        : "12",
  }))
  const formRef = useRef<HTMLFormElement>(null)
  /** Set by the confirmation, so the resumed submission is not intercepted again. */
  const confirmed = useRef(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const set =
    <K extends keyof ProgramFormValues>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value as ProgramFormValues[K] }))

  const errors = state.fieldErrors ?? {}
  const error = (field: string) => errors[field]?.[0]
  /** Binds a control to its error, or to its hint when it has one. */
  const describedBy = (field: string, hasHint = false) =>
    errors[field] ? `${field}-error` : hasHint ? `${field}-hint` : undefined

  const isOnboarding = variant === "onboarding"
  const advancedError = ADVANCED_FIELDS[variant].some((field) => errors[field])

  const settingsSummary = t("advanced.summary", {
    model: values.attributionModel === "last_click" ? t("lastClick") : t("firstClick"),
    window: Number(values.attributionWindowDays) || 0,
    hold: Number(values.commissionHoldDays) || 0,
  })

  const nameField = (
    <Field label={t("name")} htmlFor="name" required={!isOnboarding} error={error("name")}>
      <Input
        id="name"
        name="name"
        value={values.name}
        onChange={set("name")}
        placeholder={t("namePlaceholder")}
        required
        aria-describedby={describedBy("name")}
        invalid={Boolean(errors.name)}
      />
    </Field>
  )

  const websiteField =
    values.websiteUrl === undefined ? null : (
      <Field
        label={t("websiteUrl")}
        htmlFor="websiteUrl"
        hint={t("websiteUrlHint")}
        error={error("websiteUrl")}
      >
        <Input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={WEBSITE_URL_MAX_LENGTH}
          value={values.websiteUrl}
          onChange={set("websiteUrl")}
          placeholder={t("websiteUrlPlaceholder")}
          aria-describedby={describedBy("websiteUrl", true)}
          invalid={Boolean(errors.websiteUrl)}
        />
      </Field>
    )

  const [copyFrom, setCopyFrom] = useState("")
  const choice = mode === "create" && variant === "full" ? environmentChoice : undefined
  const environment = values.environment ?? "test"

  const copySettings = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const template = choice?.templates.find((candidate) => candidate.id === event.target.value)
    setCopyFrom(event.target.value)
    // The name stays the founder's: two programs of a workspace cannot share one.
    if (template) setValues((current) => ({ ...current, ...template.values, environment: "live" }))
  }

  const environmentField = choice ? (
    <div className="space-y-3">
      <Field
        label={t("environment.label")}
        htmlFor="environment"
        hint={environment === "live" ? t("environment.hintLive") : t("environment.hintTest")}
        error={error("environment")}
      >
        <Select
          id="environment"
          name="environment"
          value={environment}
          onChange={set("environment")}
          aria-invalid={errors.environment ? true : undefined}
          aria-describedby={describedBy("environment", true)}
        >
          <option value="test" disabled={!choice.test}>
            {choice.test ? t("environment.test") : t("environment.testAtLimit")}
          </option>
          <option value="live" disabled={!choice.live}>
            {choice.live ? t("environment.live") : t("environment.liveUnavailable")}
          </option>
        </Select>
      </Field>

      {choice.liveBlockedBy ? (
        <InlineAlert
          title={choice.liveBlockedBy === "plan" ? t("environment.planTitle") : t("environment.limitTitle")}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}>
                {t("environment.planAction")}
              </Link>
            </Button>
          }
        >
          {choice.liveBlockedBy === "plan" ? t("environment.planBody") : t("environment.limitBody")}
        </InlineAlert>
      ) : null}

      {environment === "live" && choice.templates.length > 0 ? (
        <Field label={t("environment.copyFrom")} htmlFor="copyFrom" hint={t("environment.copyFromHint")}>
          <Select id="copyFrom" value={copyFrom} onChange={copySettings} aria-describedby="copyFrom-hint">
            <option value="">{t("environment.copyFromNone")}</option>
            {choice.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </div>
  ) : null

  const statusField = (
    <Field label={t("status")} htmlFor="status" error={error("status")}>
      <Select
        id="status"
        name="status"
        value={values.status}
        onChange={set("status")}
        aria-invalid={errors.status ? true : undefined}
        aria-describedby={describedBy("status")}
      >
        <option value="draft">{ts("draft")}</option>
        <option value="active">{ts("active")}</option>
        <option value="paused">{ts("paused")}</option>
        <option value="archived">{ts("archived")}</option>
      </Select>
    </Field>
  )

  const typeField = (
    <Field label={t("type")} htmlFor="commissionType" error={error("commissionType")}>
      <Select
        id="commissionType"
        name="commissionType"
        value={values.commissionType}
        onChange={set("commissionType")}
        aria-invalid={errors.commissionType ? true : undefined}
        aria-describedby={describedBy("commissionType")}
      >
        <option value="percentage">{t("typePercentage")}</option>
        <option value="fixed">{t("typeFixed")}</option>
      </Select>
    </Field>
  )

  const amountField = (
    <Field
      label={
        values.commissionType === "percentage"
          ? t("rate")
          : t("amountIn", { currency: values.currency })
      }
      htmlFor="commissionAmount"
      required={!isOnboarding}
      error={error("commissionAmount")}
    >
      <Input
        id="commissionAmount"
        name="commissionAmount"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        max={values.commissionType === "percentage" ? "100" : undefined}
        value={values.commissionAmount}
        onChange={set("commissionAmount")}
        required
        aria-describedby={describedBy("commissionAmount")}
        invalid={Boolean(errors.commissionAmount)}
        className="tabular-nums"
      />
    </Field>
  )

  const currencyField = (
    <Field label={t("currency")} htmlFor="currency" error={error("currency")}>
      <Select
        id="currency"
        name="currency"
        value={values.currency}
        onChange={set("currency")}
        aria-invalid={errors.currency ? true : undefined}
        aria-describedby={describedBy("currency")}
      >
        {(currencyOptions ?? CURRENCY_CODES.map((code) => ({ value: code, label: code }))).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  )

  const recurrenceField = (className?: string) => (
    <Field
      label={t("recurrence")}
      htmlFor="recurrence"
      hint={t("recurrenceHint")}
      error={error("recurrence")}
      className={className}
    >
      <Select
        id="recurrence"
        name="recurrence"
        value={values.recurrence}
        onChange={set("recurrence")}
        aria-invalid={errors.recurrence ? true : undefined}
        aria-describedby={describedBy("recurrence", true)}
      >
        <option value="lifetime">{t("recurrenceLifetime")}</option>
        <option value="first_only">{t("recurrenceFirst")}</option>
        <option value="months">{t("recurrenceMonths")}</option>
      </Select>
    </Field>
  )

  const durationField =
    values.recurrence === "months" ? (
      <Field
        label={t("durationMonths")}
        htmlFor="durationMonths"
        hint={t("durationMonthsHint")}
        error={error("durationMonths")}
      >
        <Input
          id="durationMonths"
          name="durationMonths"
          type="number"
          inputMode="numeric"
          min={DURATION_MONTHS_MIN}
          max={DURATION_MONTHS_MAX}
          value={values.durationMonths}
          onChange={set("durationMonths")}
          aria-describedby={describedBy("durationMonths", true)}
          invalid={Boolean(errors.durationMonths)}
          className="tabular-nums"
        />
      </Field>
    ) : null

  // Jargon gets a one-line explanation right under the control: a tooltip
  // cannot be read on a phone and hides the answer behind a hover.
  const modelField = (
    <Field
      label={t("model")}
      htmlFor="attributionModel"
      hint={values.attributionModel === "last_click" ? t("lastClickHint") : t("firstClickHint")}
      error={error("attributionModel")}
    >
      <Select
        id="attributionModel"
        name="attributionModel"
        value={values.attributionModel}
        onChange={set("attributionModel")}
        aria-invalid={errors.attributionModel ? true : undefined}
        aria-describedby={describedBy("attributionModel", true)}
      >
        <option value="last_click">{t("lastClick")}</option>
        <option value="first_click">{t("firstClick")}</option>
      </Select>
    </Field>
  )

  const windowField = (
    <Field
      label={t("windowDays")}
      htmlFor="attributionWindowDays"
      hint={t("windowDaysHint")}
      error={error("attributionWindowDays")}
    >
      <Input
        id="attributionWindowDays"
        name="attributionWindowDays"
        type="number"
        inputMode="numeric"
        min="1"
        max="365"
        value={values.attributionWindowDays}
        onChange={set("attributionWindowDays")}
        aria-describedby={describedBy("attributionWindowDays", true)}
        invalid={Boolean(errors.attributionWindowDays)}
        className="tabular-nums"
      />
    </Field>
  )

  const holdField = (
    <Field
      label={t("holdDays")}
      htmlFor="commissionHoldDays"
      hint={t("holdDaysHint")}
      error={error("commissionHoldDays")}
    >
      <Input
        id="commissionHoldDays"
        name="commissionHoldDays"
        type="number"
        inputMode="numeric"
        min="0"
        max="180"
        value={values.commissionHoldDays}
        onChange={set("commissionHoldDays")}
        aria-describedby={describedBy("commissionHoldDays", true)}
        invalid={Boolean(errors.commissionHoldDays)}
        className="tabular-nums"
      />
    </Field>
  )

  const feedback = state.error ? (
    <InlineAlert tone="danger">{state.error}</InlineAlert>
  ) : state.success ? (
    <InlineAlert tone="success">{state.success}</InlineAlert>
  ) : null

  const hiddenFields = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {defaultValues.id ? <input type="hidden" name="programId" value={defaultValues.id} /> : null}
    </>
  )

  if (isOnboarding) {
    return (
      <form action={action} noValidate>
        {hiddenFields}
        <input type="hidden" name="onboarding" value="1" />
        {/* A new workspace is on Sandbox: its first program is a test program. */}
        <input type="hidden" name="environment" value="test" />

        <Card className="space-y-4 p-4 sm:p-6">
          {nameField}

          <div className="grid gap-4 sm:grid-cols-2">
            {typeField}
            {amountField}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {recurrenceField(durationField ? undefined : "sm:col-span-2")}
            {durationField}
          </div>

          <SettingsDisclosure
            title={t("advanced.title")}
            summary={t("advanced.summaryWithStatus", {
              status: ts(values.status),
              settings: settingsSummary,
            })}
            forceOpen={advancedError}
          >
            {websiteField}
            <div className="grid gap-4 sm:grid-cols-2">
              {statusField}
              {currencyField}
            </div>
            {modelField}
            {windowField}
            {holdField}
          </SettingsDisclosure>

          {feedback}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full max-sm:h-11"
            loading={pending}
          >
            {t("submitCreate")}
          </Button>
        </Card>
      </form>
    )
  }

  // What saving really changes, stated before it happens. The rules live in
  // the services: `tracking.ts` attributes a click only while the program is
  // `active` (clicks are still recorded), and the commission engine skips any
  // payment whose currency differs from the program's
  // (`domain/commission.ts`, "currency_mismatch"). Neither rewrites a
  // commission already on the ledger.
  const stopsAttributing =
    mode === "edit" && values.status !== "active" && values.status !== defaultValues.status
  const changesCurrency = mode === "edit" && values.currency !== defaultValues.currency
  const consequences = [
    stopsAttributing ? t("confirm.statusBody", { status: ts(values.status) }) : null,
    changesCurrency ? t("confirm.currencyBody", { from: defaultValues.currency, to: values.currency }) : null,
  ].filter((line): line is string => line !== null)

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (confirmed.current) {
      confirmed.current = false
      return
    }
    if (consequences.length > 0) {
      // Prevented outside a transition, React does not run the form action.
      event.preventDefault()
      setConfirmOpen(true)
    }
  }

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} noValidate>
        {hiddenFields}

        {/* One container for the whole form, its groups divided by hairlines —
            the same `FormSection` grid as every other form in the product. */}
        <Card>
          <FormSection title={t("basics.title")} description={t("basics.description")}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">{nameField}</div>
              {statusField}
            </div>

            {environmentField}

            <Field
              label={t("description")}
              htmlFor="description"
              hint={t("descriptionHint")}
              error={error("description")}
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                value={values.description}
                onChange={set("description")}
                aria-describedby={describedBy("description", true)}
                invalid={Boolean(errors.description)}
              />
            </Field>

            {websiteField}
          </FormSection>

          <FormSection title={t("commission.title")} description={t("commission.description")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {typeField}
              {amountField}
            </div>
            {currencyField}

            <div className="grid gap-4 sm:grid-cols-2">
              {recurrenceField(durationField ? undefined : "sm:col-span-2")}
              {durationField}
            </div>
          </FormSection>

          <FormSection title={t("attribution.title")} description={t("advanced.description")}>
            <SettingsDisclosure
              title={t("advanced.title")}
              summary={settingsSummary}
              defaultOpen={mode === "edit"}
              forceOpen={advancedError}
            >
              {modelField}
              <div className="grid gap-4 sm:grid-cols-2">
                {windowField}
                {holdField}
              </div>
            </SettingsDisclosure>
          </FormSection>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3 sm:px-5">
            {feedback ? <div className="mr-auto min-w-0">{feedback}</div> : null}
            {mode === "create" ? (
              <Button asChild variant="secondary">
                <Link href={{ pathname: "/[workspaceSlug]/programs", params: { workspaceSlug } }}>
                  {ta("cancel")}
                </Link>
              </Button>
            ) : null}
            <Button type="submit" variant="primary" loading={pending}>
              {mode === "create" ? t("submitCreate") : t("submitSave")}
            </Button>
          </div>
        </Card>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone={stopsAttributing ? "danger" : "primary"}
        title={t("confirm.title")}
        description={consequences.join(" ")}
        confirmLabel={t("confirm.action")}
        action={() => {
          confirmed.current = true
          formRef.current?.requestSubmit()
        }}
      />
    </>
  )
}
