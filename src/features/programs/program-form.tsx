"use client"

import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select, Textarea } from "@/components/ui/input"
import { CURRENCIES } from "@/features/workspaces/options"

import { createProgramAction, updateProgramAction, type ProgramFormState } from "./actions"

const INITIAL: ProgramFormState = {}

export interface ProgramFormValues {
  id?: string
  name: string
  description: string
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

export function ProgramForm({
  workspaceSlug,
  defaultValues,
  mode,
}: {
  workspaceSlug: string
  defaultValues: ProgramFormValues
  mode: "create" | "edit"
}) {
  const t = useTranslations("forms.program")
  const ts = useTranslations("status")
  const [state, action, pending] = useActionState(
    mode === "create" ? createProgramAction : updateProgramAction,
    INITIAL,
  )

  const [commissionType, setCommissionType] = useState(defaultValues.commissionType)
  const [recurrence, setRecurrence] = useState(defaultValues.recurrence)

  return (
    <form action={action} noValidate>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {defaultValues.id ? <input type="hidden" name="programId" value={defaultValues.id} /> : null}

      {/* One container for the whole form; its sections are divided by
          hairlines rather than stacked as separate cards. */}
      <Card className="divide-y divide-border">
        <FormSection title={t("basics.title")} description={t("basics.description")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t("name")}
              htmlFor="name"
              required
              error={state.fieldErrors?.name?.[0]}
              className="sm:col-span-2"
            >
              <Input
                id="name"
                name="name"
                defaultValue={defaultValues.name}
                placeholder={t("namePlaceholder")}
                required
                invalid={Boolean(state.fieldErrors?.name)}
              />
            </Field>

            <Field label={t("status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={defaultValues.status}>
                <option value="draft">{ts("draft")}</option>
                <option value="active">{ts("active")}</option>
                <option value="paused">{ts("paused")}</option>
                <option value="archived">{ts("archived")}</option>
              </Select>
            </Field>
          </div>

          <Field label={t("description")} htmlFor="description" hint={t("descriptionHint")}>
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={defaultValues.description}
            />
          </Field>
        </FormSection>

        <FormSection title={t("commission.title")} description={t("commission.description")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("type")} htmlFor="commissionType">
              <Select
                id="commissionType"
                name="commissionType"
                value={commissionType}
                onChange={(event) =>
                  setCommissionType(event.target.value as ProgramFormValues["commissionType"])
                }
              >
                <option value="percentage">{t("typePercentage")}</option>
                <option value="fixed">{t("typeFixed")}</option>
              </Select>
            </Field>

            <Field
              label={commissionType === "percentage" ? t("rate") : t("amount")}
              htmlFor="commissionAmount"
              required
              error={state.fieldErrors?.commissionAmount?.[0]}
            >
              <Input
                id="commissionAmount"
                name="commissionAmount"
                type="number"
                step="0.01"
                min="0.01"
                max={commissionType === "percentage" ? "100" : undefined}
                defaultValue={defaultValues.commissionAmount}
                required
                invalid={Boolean(state.fieldErrors?.commissionAmount)}
                className="tabular-nums"
              />
            </Field>

            <Field label={t("currency")} htmlFor="currency">
              <Select id="currency" name="currency" defaultValue={defaultValues.currency}>
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("recurrence")} htmlFor="recurrence" className="sm:col-span-2">
              <Select
                id="recurrence"
                name="recurrence"
                value={recurrence}
                onChange={(event) =>
                  setRecurrence(event.target.value as ProgramFormValues["recurrence"])
                }
              >
                <option value="first_only">{t("recurrenceFirst")}</option>
                <option value="months">{t("recurrenceMonths")}</option>
                <option value="lifetime">{t("recurrenceLifetime")}</option>
              </Select>
            </Field>

            {recurrence === "months" ? (
              <Field
                label={t("durationMonths")}
                htmlFor="durationMonths"
                error={state.fieldErrors?.durationMonths?.[0]}
              >
                <Input
                  id="durationMonths"
                  name="durationMonths"
                  type="number"
                  min="1"
                  max="120"
                  defaultValue={defaultValues.durationMonths}
                  className="tabular-nums"
                />
              </Field>
            ) : null}
          </div>

          <Field label={t("holdDays")} htmlFor="commissionHoldDays" hint={t("holdDaysHint")}>
            <Input
              id="commissionHoldDays"
              name="commissionHoldDays"
              type="number"
              min="0"
              max="180"
              defaultValue={defaultValues.commissionHoldDays}
              className="tabular-nums sm:max-w-40"
            />
          </Field>
        </FormSection>

        <FormSection title={t("attribution.title")} description={t("attribution.description")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("model")} htmlFor="attributionModel" className="sm:col-span-2">
              <Select
                id="attributionModel"
                name="attributionModel"
                defaultValue={defaultValues.attributionModel}
              >
                <option value="last_click">{t("lastClick")}</option>
                <option value="first_click">{t("firstClick")}</option>
              </Select>
            </Field>

            <Field
              label={t("windowDays")}
              htmlFor="attributionWindowDays"
              error={state.fieldErrors?.attributionWindowDays?.[0]}
            >
              <Input
                id="attributionWindowDays"
                name="attributionWindowDays"
                type="number"
                min="1"
                max="365"
                defaultValue={defaultValues.attributionWindowDays}
                className="tabular-nums"
              />
            </Field>
          </div>
        </FormSection>

        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          {state.error ? (
            <p role="alert" className="mr-auto text-caption text-danger-foreground">
              {state.error}
            </p>
          ) : state.success ? (
            <p role="status" className="mr-auto text-caption text-success-foreground">
              {state.success}
            </p>
          ) : null}
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
