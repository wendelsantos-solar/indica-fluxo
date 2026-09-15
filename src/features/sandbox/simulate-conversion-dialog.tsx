"use client"

import { FlaskConical } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
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
import { useFormatters } from "@/i18n/use-formatters"

import {
  simulateConversionAction,
  simulateRefundAction,
  simulateRenewalAction,
  type SimulationFormState,
} from "./actions"

const INITIAL: SimulationFormState = {}

function newSimulationId(): string {
  return crypto.randomUUID()
}

/**
 * "Simular conversão" for a TEST program: a synthetic click, identify and
 * payment through the real services, then — for the same simulated customer —
 * a renewal or a refund. Only for test programs; the server refuses live ones.
 *
 * Each submission carries a fresh `simulationId`, so a double click replays the
 * same simulation instead of recording two.
 */
export function SimulateConversionDialog({
  workspaceSlug,
  programId,
  participations,
  currency,
}: {
  workspaceSlug: string
  programId: string
  /** Approved participations of this program. */
  participations: { id: string; name: string }[]
  /** The program's currency; amounts are typed in its major unit. */
  currency: string
}) {
  const t = useTranslations("forms.sandbox")
  const ts = useTranslations("status")
  const ta = useTranslations("common.actions")
  const f = useFormatters()

  const [open, setOpen] = useState(false)
  const [conversion, convert, converting] = useActionState(simulateConversionAction, INITIAL)
  const [renewal, renew, renewing] = useActionState(simulateRenewalAction, INITIAL)
  const [refund, refundLatest, refunding] = useActionState(simulateRefundAction, INITIAL)
  // One id per attempt: regenerated whenever a submission settles.
  const [ids, setIds] = useState(() => ({ conversion: newSimulationId(), renewal: newSimulationId(), refund: newSimulationId() }))
  const [seen, setSeen] = useState({ conversion, renewal, refund })
  if (seen.conversion !== conversion || seen.renewal !== renewal || seen.refund !== refund) {
    setSeen({ conversion, renewal, refund })
    setIds({ conversion: newSimulationId(), renewal: newSimulationId(), refund: newSimulationId() })
  }
  const [dismissed, setDismissed] = useState<SimulationFormState | null>(null)

  const simulated = conversion.result && conversion !== dismissed ? conversion.result : null
  const latest = [refund, renewal].find((state) => state.result && simulated && state.result.customerExternalId === simulated.customerExternalId)

  const hidden = (kind: keyof typeof ids) => (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="simulationId" value={ids[kind]} />
    </>
  )

  const summary = (state: SimulationFormState) => {
    const commission = state.result?.commission
    if (!commission) return t("result.noCommission")
    return commission.amountMinor < 0
      ? t("result.reversal", { amount: f.money(-commission.amountMinor, commission.currency) })
      : t("result.commission", {
          amount: f.money(commission.amountMinor, commission.currency),
          status: ts(commission.status),
          date: f.date(new Date(commission.eligibleAt)),
        })
  }

  if (participations.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FlaskConical aria-hidden="true" />
          {t("trigger")}
        </Button>
      </DialogTrigger>

      <DialogContent size="form">
        {simulated ? (
          <div className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>{t("result.title")}</DialogTitle>
              <DialogDescription>{t("result.description")}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <InlineAlert tone={conversion.result?.commission ? "success" : "info"}>{summary(conversion)}</InlineAlert>
              <p className="text-meta text-muted-foreground">
                {t("result.customer")} <code className="font-mono text-meta text-foreground">{simulated.customerExternalId}</code>
              </p>

              {latest?.result ? (
                <InlineAlert tone={latest.result.commission ? "success" : "info"}>{summary(latest)}</InlineAlert>
              ) : null}
              {renewal.error ? <InlineAlert tone="danger">{renewal.error}</InlineAlert> : null}
              {refund.error ? <InlineAlert tone="danger">{refund.error}</InlineAlert> : null}

              <form action={renew} noValidate className="space-y-3 border-t border-border-faint pt-4">
                {hidden("renewal")}
                <input type="hidden" name="customerExternalId" value={simulated.customerExternalId} />
                <Field label={t("renewalAmount")} htmlFor="sandbox-renewal-amount" hint={t("renewalHint")}>
                  <Input
                    id="sandbox-renewal-amount"
                    name="amount"
                    inputMode="decimal"
                    placeholder={t("amountPlaceholder")}
                    className="tabular-nums sm:max-w-40"
                    aria-describedby="sandbox-renewal-amount-hint"
                    required
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="secondary" size="sm" loading={renewing}>
                    {t("renew")}
                  </Button>
                </div>
              </form>

              <form action={refundLatest} noValidate className="flex flex-wrap items-center justify-between gap-3 border-t border-border-faint pt-4">
                {hidden("refund")}
                <input type="hidden" name="customerExternalId" value={simulated.customerExternalId} />
                <p className="max-w-prose text-meta text-muted-foreground">{t("refundHint")}</p>
                <Button type="submit" variant="danger" size="sm" loading={refunding}>
                  {t("refund")}
                </Button>
              </form>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDismissed(conversion)}>
                {t("again")}
              </Button>
              <Button type="button" variant="primary" onClick={() => setOpen(false)}>
                {t("done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={convert} noValidate className="flex min-h-0 flex-col">
            {hidden("conversion")}
            <input type="hidden" name="programId" value={programId} />

            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>

            <DialogBody>
              {conversion.error ? <InlineAlert tone="danger">{conversion.error}</InlineAlert> : null}

              <Field label={t("affiliate")} htmlFor="sandbox-participation" required>
                <Select id="sandbox-participation" name="participationId" defaultValue={participations[0]?.id} required>
                  {participations.map((participation) => (
                    <option key={participation.id} value={participation.id}>
                      {participation.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("amount", { currency })}
                  htmlFor="sandbox-amount"
                  required
                  hint={t("amountHint")}
                >
                  <Input
                    id="sandbox-amount"
                    name="amount"
                    inputMode="decimal"
                    placeholder={t("amountPlaceholder")}
                    className="tabular-nums"
                    aria-describedby="sandbox-amount-hint"
                    required
                  />
                </Field>

                <Field label={t("externalId")} htmlFor="sandbox-external-id" hint={t("externalIdHint")}>
                  <Input
                    id="sandbox-external-id"
                    name="externalId"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    aria-describedby="sandbox-external-id-hint"
                  />
                </Field>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {ta("cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={converting}>
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
