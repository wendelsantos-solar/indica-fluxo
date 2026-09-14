"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {defaultValues.id ? <input type="hidden" name="programId" value={defaultValues.id} /> : null}

      <Card>
        <CardHeader bordered>
          <div>
            <CardTitle>{t("basics.title")}</CardTitle>
            <CardDescription>{t("basics.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field
              label={t("name")}
              htmlFor="name"
              required
              error={state.fieldErrors?.name?.[0]}
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

          <Field
            label={t("description")}
            htmlFor="description"
            hint={t("descriptionHint")}
          >
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={defaultValues.description}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader bordered>
          <div>
            <CardTitle>{t("commission.title")}</CardTitle>
            <CardDescription>
              {t("commission.description")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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
                step={commissionType === "percentage" ? "0.01" : "0.01"}
                min="0.01"
                max={commissionType === "percentage" ? "100" : undefined}
                defaultValue={defaultValues.commissionAmount}
                required
                invalid={Boolean(state.fieldErrors?.commissionAmount)}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("recurrence")} htmlFor="recurrence">
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
                />
              </Field>
            ) : null}
          </div>

          <Field
            label={t("holdDays")}
            htmlFor="commissionHoldDays"
            hint={t("holdDaysHint")}
          >
            <Input
              id="commissionHoldDays"
              name="commissionHoldDays"
              type="number"
              min="0"
              max="180"
              defaultValue={defaultValues.commissionHoldDays}
              className="sm:max-w-[200px]"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader bordered>
          <div>
            <CardTitle>{t("attribution.title")}</CardTitle>
            <CardDescription>{t("attribution.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("model")} htmlFor="attributionModel">
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
            />
          </Field>
        </CardContent>
      </Card>

      {state.error ? (
        <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-caption text-danger-foreground">
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p role="status" className="rounded-control bg-success-subtle px-3 py-2 text-caption text-success-foreground">
          {state.success}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" loading={pending}>
          {mode === "create" ? t("submitCreate") : t("submitSave")}
        </Button>
      </div>
    </form>
  )
}
