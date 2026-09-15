"use client"

import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select, Textarea } from "@/components/ui/input"
import { SettingsDisclosure } from "@/features/onboarding/settings-disclosure"
import { CURRENCY_CODES } from "@/features/workspaces/options"

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
 */
export function ProgramForm({
  workspaceSlug,
  defaultValues,
  mode,
  variant = "full",
}: {
  workspaceSlug: string
  defaultValues: ProgramFormValues
  mode: "create" | "edit"
  variant?: "full" | "onboarding"
}) {
  const t = useTranslations("forms.program")
  const ts = useTranslations("status")
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
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
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

  return (
    <form action={action} noValidate>
      {hiddenFields}

      {/* One container for the whole form; its sections are divided by
          hairlines rather than stacked as separate cards. */}
      <Card className="divide-y divide-border">
        <FormSection title={t("basics.title")} description={t("basics.description")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">{nameField}</div>
            {statusField}
          </div>

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
          <div className="grid gap-4 sm:grid-cols-3">
            {typeField}
            {amountField}
            {currencyField}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {recurrenceField("sm:col-span-2")}
            {durationField}
          </div>
        </FormSection>

        <SettingsDisclosure
          framed={false}
          title={t("advanced.title")}
          summary={settingsSummary}
          defaultOpen={mode === "edit"}
          forceOpen={advancedError}
        >
          <div className="grid gap-4 md:grid-cols-3 md:gap-8">
            <p className="text-caption text-muted-foreground">{t("advanced.description")}</p>
            <div className="space-y-4 md:col-span-2">
              {modelField}
              <div className="grid gap-4 sm:grid-cols-2">
                {windowField}
                {holdField}
              </div>
            </div>
          </div>
        </SettingsDisclosure>

        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          {feedback ? <div className="mr-auto">{feedback}</div> : null}
          <Button type="submit" variant="primary" loading={pending}>
            {mode === "create" ? t("submitCreate") : t("submitSave")}
          </Button>
        </div>
      </Card>
    </form>
  )
}

/** A titled block of fields: heading on the left, controls on the right. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-4 p-4 md:grid-cols-3 md:gap-8 md:py-6">
      <div>
        <h2 className="text-caption font-medium text-foreground">{title}</h2>
        <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4 md:col-span-2">{children}</div>
    </section>
  )
}
