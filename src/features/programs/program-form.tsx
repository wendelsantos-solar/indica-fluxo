"use client"

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
            <CardTitle>Basics</CardTitle>
            <CardDescription>What affiliates will see when they join.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field
              label="Program name"
              htmlFor="name"
              required
              error={state.fieldErrors?.name?.[0]}
            >
              <Input
                id="name"
                name="name"
                defaultValue={defaultValues.name}
                placeholder="Acme Partners"
                required
                invalid={Boolean(state.fieldErrors?.name)}
              />
            </Field>

            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={defaultValues.status}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor="description"
            hint="Optional. Shown to affiliates in their portal."
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
            <CardTitle>Commission</CardTitle>
            <CardDescription>
              What an affiliate earns, and for how long after the first payment.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" htmlFor="commissionType">
              <Select
                id="commissionType"
                name="commissionType"
                value={commissionType}
                onChange={(event) =>
                  setCommissionType(event.target.value as ProgramFormValues["commissionType"])
                }
              >
                <option value="percentage">Percentage of payment</option>
                <option value="fixed">Fixed amount</option>
              </Select>
            </Field>

            <Field
              label={commissionType === "percentage" ? "Rate (%)" : "Amount"}
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

            <Field label="Currency" htmlFor="currency">
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
            <Field label="Recurrence" htmlFor="recurrence">
              <Select
                id="recurrence"
                name="recurrence"
                value={recurrence}
                onChange={(event) =>
                  setRecurrence(event.target.value as ProgramFormValues["recurrence"])
                }
              >
                <option value="first_only">First payment only</option>
                <option value="months">For a number of months</option>
                <option value="lifetime">Lifetime</option>
              </Select>
            </Field>

            {recurrence === "months" ? (
              <Field
                label="Duration (months)"
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
            label="Hold period (days)"
            htmlFor="commissionHoldDays"
            hint="Commissions stay pending for this long before they can be paid — your refund window."
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
            <CardTitle>Attribution</CardTitle>
            <CardDescription>Which affiliate gets credited when a visitor converts.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Model" htmlFor="attributionModel">
            <Select
              id="attributionModel"
              name="attributionModel"
              defaultValue={defaultValues.attributionModel}
            >
              <option value="last_click">Last click</option>
              <option value="first_click">First click</option>
            </Select>
          </Field>

          <Field
            label="Attribution window (days)"
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
          {mode === "create" ? "Create program" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
