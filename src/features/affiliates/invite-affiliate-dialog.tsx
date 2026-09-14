"use client"

import { Plus } from "lucide-react"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { inviteAffiliateAction, type AffiliateFormState } from "./actions"

const INITIAL: AffiliateFormState = {}

export function InviteAffiliateDialog({
  workspaceSlug,
  programs,
  defaultProgramId,
  triggerLabel = "Invite affiliate",
}: {
  workspaceSlug: string
  programs: { id: string; name: string }[]
  defaultProgramId?: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(inviteAffiliateAction, INITIAL)

  useActionResult(state, { onSuccess: () => setOpen(false) })

  if (programs.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form action={action} noValidate>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

          <DialogHeader>
            <DialogTitle>Invite an affiliate</DialogTitle>
            <DialogDescription>
              They do not need an account yet. The record is claimed automatically the first time
              they sign in with this e-mail address.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field label="Program" htmlFor="programId" required>
              <Select id="programId" name="programId" defaultValue={defaultProgramId} required>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required error={state.fieldErrors?.name?.[0]}>
                <Input id="name" name="name" required invalid={Boolean(state.fieldErrors?.name)} />
              </Field>

              <Field label="E-mail" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  invalid={Boolean(state.fieldErrors?.email)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Referral code"
                htmlFor="code"
                hint="Leave blank to derive it from the name."
                error={state.fieldErrors?.code?.[0]}
              >
                <Input id="code" name="code" placeholder="wendel" className="font-mono" />
              </Field>

              <Field
                label="Custom rate (%)"
                htmlFor="customRate"
                hint="Optional. Overrides the program rate."
                error={state.fieldErrors?.customRate?.[0]}
              >
                <Input id="customRate" name="customRate" type="number" min="0" max="100" step="0.5" />
              </Field>
            </div>

            <Field label="Company" htmlFor="companyName" hint="Optional.">
              <Input id="companyName" name="companyName" />
            </Field>

            {state.error ? (
              <p role="alert" className="rounded-[6px] bg-danger-subtle px-3 py-2 text-[12px] text-danger-foreground">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Add affiliate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
