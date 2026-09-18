"use client"

import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CONNECTORS, type ConnectorAvailability, type ConnectorId } from "@/lib/billing/catalog"
import { cn } from "@/lib/utils"

import { saveProviderSelectionAction, type ConnectionFormState } from "./connection-actions"
import { ProviderMark } from "./provider-mark"

/**
 * "Como seu SaaS recebe pagamentos?" — a multi-select, never a radio: a SaaS
 * may charge through several providers (brief §21, §23). The selection only
 * shapes the setup progress; it gates nothing and can change any time.
 * Real checkboxes, styled as cards, so keyboard and screen readers get the
 * native semantics.
 */
export function ProviderSelection({
  workspaceSlug,
  availability,
  selected,
  other = false,
  readOnly = false,
}: {
  workspaceSlug: string
  availability: Record<ConnectorId, ConnectorAvailability>
  selected: ConnectorId[] | null
  /** "Outro" was saved before. */
  other?: boolean
  readOnly?: boolean
}) {
  const t = useTranslations("forms.billing.selection")
  const tAvailability = useTranslations("forms.billing.availability")
  const tAdd = useTranslations("forms.billing.add")
  const [state, action, pending] = useActionState(saveProviderSelectionAction, {} as ConnectionFormState)
  const [chosen, setChosen] = useState<ConnectorId[]>(selected ?? [])
  const [otherChosen, setOtherChosen] = useState(other)
  const ids = Object.keys(CONNECTORS) as ConnectorId[]

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <fieldset disabled={readOnly || pending}>
        <legend className="sr-only">{t("title")}</legend>
        <p className="text-caption text-muted-foreground">{t("description")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {ids.map((id) => {
            const checked = chosen.includes(id)
            const unavailable = availability[id] === "coming_soon"
            return (
              <label
                key={id}
                className={cn(
                  "relative flex cursor-pointer items-center gap-3 rounded-panel border bg-surface-1 p-3 transition-colors",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
                  checked ? "border-foreground-secondary" : "border-border hover:border-border-strong",
                  unavailable && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  name="providers"
                  value={id}
                  checked={checked}
                  disabled={unavailable}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked ? [...current, id] : current.filter((value) => value !== id),
                    )
                  }
                  className="sr-only"
                />
                <ProviderMark provider={id} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-caption font-medium text-foreground">
                    {CONNECTORS[id].name}
                    {availability[id] !== "public" ? (
                      <Badge dot={false} title={availability[id] === "beta" ? tAdd("betaNote") : undefined}>
                        {tAvailability(availability[id])}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-meta text-muted-foreground">{t(`methods.${id}`)}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-badge border",
                    checked ? "border-foreground bg-foreground text-surface-1" : "border-border-strong",
                  )}
                >
                  {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                </span>
              </label>
            )
          })}
          <label
            className={cn(
              "relative flex cursor-pointer items-center gap-3 rounded-panel border bg-surface-1 p-3 transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
              otherChosen ? "border-foreground-secondary" : "border-border hover:border-border-strong",
            )}
          >
            <input
              type="checkbox"
              name="providers"
              value="other"
              checked={otherChosen}
              onChange={(event) => setOtherChosen(event.target.checked)}
              className="sr-only"
            />
            <ProviderMark provider={t("otherName")} />
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-medium text-foreground">{t("otherName")}</span>
              <span className="block text-meta text-muted-foreground">{t("methods.other")}</span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-badge border",
                otherChosen ? "border-foreground bg-foreground text-surface-1" : "border-border-strong",
              )}
            >
              {otherChosen ? <Check className="size-3" strokeWidth={2.5} /> : null}
            </span>
          </label>
        </div>
        {otherChosen ? <p className="mt-2 max-w-prose text-meta text-muted-foreground">{t("otherNote")}</p> : null}
      </fieldset>
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={pending}>
            {t("save")}
          </Button>
          <p className="text-meta text-muted-foreground" role="status" aria-live="polite">
            {state.success ?? t("later")}
          </p>
        </div>
      ) : null}
    </form>
  )
}
