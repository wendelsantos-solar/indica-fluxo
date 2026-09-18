"use client"

import { ArrowLeft, ChevronDown, Eye, EyeOff, Plus, Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState, useEffect, useId, useMemo, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Badge } from "@/components/ui/badge"
import { Button, type ButtonProps } from "@/components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Link, useRouter } from "@/i18n/navigation"
import { CONNECTORS, type ConnectorAvailability, type ConnectorId } from "@/lib/billing/catalog"

import { startStripeAction, type IntegrationFormState } from "./actions"
import { connectProviderAction, type ConnectionFormState } from "./connection-actions"
import { ProviderMark } from "./provider-mark"

export interface ProviderOption {
  id: ConnectorId
  availability: ConnectorAvailability
  /** Connections of this provider the workspace already has. */
  connected: number
  /** Manual setups started and not finished — resumed rather than duplicated. */
  incomplete?: { id: string; label: string }[]
}

type View = { kind: "list" } | { kind: "connect"; provider: ConnectorId }

/**
 * "Conectar meio de pagamento": search, pick, connect — in one dialog.
 *
 * Every provider says honestly what it takes (brief §10): Stripe one click
 * when the platform has Connect, AbacatePay and Asaas one API key (the webhook
 * is registered for the founder), Mercado Pago a token plus one step in its
 * panel. "Em breve" is never clickable. Nothing turns green here: the dialog
 * hands over to the connection's page, whose status comes from the backend.
 */
export function AddProviderDialog({
  workspaceSlug,
  providers,
  stripeConnectUrl,
  initialProvider,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize = "sm",
}: {
  workspaceSlug: string
  providers: ProviderOption[]
  /** "Connect with Stripe" (OAuth) when the platform has it; otherwise the manual account form. */
  stripeConnectUrl: string | null
  initialProvider?: ConnectorId
  triggerLabel?: string
  triggerVariant?: ButtonProps["variant"]
  triggerSize?: ButtonProps["size"]
}) {
  const t = useTranslations("forms.billing")
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>(initialProvider ? { kind: "connect", provider: initialProvider } : { kind: "list" })

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setView(initialProvider ? { kind: "connect", provider: initialProvider } : { kind: "list" })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Plus aria-hidden="true" />
          {triggerLabel ?? t("add.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent size="form">
        {view.kind === "list" ? (
          <ProviderList
            providers={providers}
            stripeConnectUrl={stripeConnectUrl}
            onPick={(provider) => setView({ kind: "connect", provider })}
          />
        ) : (
          <ConnectView
            workspaceSlug={workspaceSlug}
            provider={view.provider}
            incomplete={providers.find((option) => option.id === view.provider)?.incomplete ?? []}
            stripeConnectUrl={stripeConnectUrl}
            onBack={initialProvider ? undefined : () => setView({ kind: "list" })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProviderList({
  providers,
  stripeConnectUrl,
  onPick,
}: {
  providers: ProviderOption[]
  stripeConnectUrl: string | null
  onPick: (provider: ConnectorId) => void
}) {
  const t = useTranslations("forms.billing")
  const [query, setQuery] = useState("")
  const searchId = useId()
  const visible = useMemo(
    () => providers.filter((option) => CONNECTORS[option.id].name.toLowerCase().includes(query.trim().toLowerCase())),
    [providers, query],
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("add.title")}</DialogTitle>
        <DialogDescription>{t("add.description")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            {t("add.search")}
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("add.search")}
            className="pl-8"
            autoComplete="off"
          />
        </div>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-caption text-muted-foreground">{t("add.noResults")}</p>
        ) : (
          <ul className="divide-y divide-border-faint border-y border-border">
            {visible.map((option) => {
              const descriptor = CONNECTORS[option.id]
              const effortKey = option.id === "stripe" ? (stripeConnectUrl ? "stripeOauth" : "stripeManual") : option.id
              return (
                <li key={option.id} className="flex items-center gap-3 py-3">
                  <ProviderMark provider={option.id} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-caption font-medium text-foreground">
                      {descriptor.name}
                      {option.availability === "beta" ? (
                        <Badge dot={false} title={t("add.betaNote")}>
                          {t("availability.beta")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {option.availability === "public" ? `${t("add.stable")} · ` : ""}
                      {t(`effort.${effortKey}`)}
                      {option.connected > 0 ? ` · ${t("add.connectedCount", { count: option.connected })}` : ""}
                    </p>
                  </div>
                  {option.availability === "coming_soon" ? (
                    <span className="text-meta text-faint-foreground">{t("availability.coming_soon")}</span>
                  ) : option.id === "stripe" && stripeConnectUrl ? (
                    <Button asChild size="sm">
                      <a href={stripeConnectUrl}>{option.connected > 0 ? t("add.connectAnother") : t("add.connect")}</a>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => onPick(option.id)}>
                      {option.connected > 0 ? t("add.connectAnother") : t("add.connect")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {visible.some((option) => option.availability === "beta") ? (
          <p className="text-meta text-muted-foreground">{t("add.betaNote")}</p>
        ) : null}
      </DialogBody>
    </>
  )
}

const INITIAL: ConnectionFormState & IntegrationFormState = {}

function ConnectView({
  workspaceSlug,
  provider,
  stripeConnectUrl,
  incomplete,
  onBack,
}: {
  workspaceSlug: string
  provider: ConnectorId
  /** Setups of this provider started and not finished: offered before a new one (brief §6). */
  incomplete: { id: string; label: string }[]
  stripeConnectUrl: string | null
  onBack?: () => void
}) {
  const t = useTranslations("forms.billing")
  const router = useRouter()
  const name = CONNECTORS[provider].name
  const isStripe = provider === "stripe"
  const [state, action, pending] = useActionState(isStripe ? startStripeAction : connectProviderAction, INITIAL)
  const [reveal, setReveal] = useState(false)

  // The backend confirmed: open the connection, whose status is the truth.
  useEffect(() => {
    if (state.integrationId) {
      router.push({
        pathname: "/[workspaceSlug]/integrations/[connectionId]",
        params: { workspaceSlug, connectionId: state.integrationId },
      })
    }
  }, [state.integrationId, router, workspaceSlug])

  const form = (
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {!isStripe ? <input type="hidden" name="provider" value={provider} /> : null}

      <Field label={t("connect.nameLabel")} htmlFor="connection-name" hint={t("connect.nameHint")}>
        <Input id="connection-name" name="displayName" maxLength={60} autoComplete="off" />
      </Field>

      {isStripe ? (
        <Field label={t("connect.stripeAccountLabel")} htmlFor="providerAccountId" hint={t("connect.stripeAccountHint")}>
          <Input id="providerAccountId" name="providerAccountId" placeholder="acct_…" required autoComplete="off" spellCheck={false} className="font-mono" />
        </Field>
      ) : (
        <Field label={t(`connect.keyLabel.${provider}`)} htmlFor="connection-key" hint={t(`connect.keyHint.${provider}`)}>
          <div className="relative">
            <Input
              id="connection-key"
              name="apiKey"
              type={reveal ? "text" : "password"}
              required
              autoComplete="off"
              spellCheck={false}
              className="pr-10 font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => setReveal((value) => !value)}
              aria-label={reveal ? t("connect.hide") : t("connect.show")}
              aria-pressed={reveal}
            >
              {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
        </Field>
      )}

      {!isStripe ? <p className="text-meta text-muted-foreground">{t("connect.security")}</p> : null}

      {state.error ? (
        <InlineAlert tone="danger" title={t("connect.failedTitle", { provider: name })}>
          {state.error}
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {isStripe ? t("connect.stripeContinue") : t("connect.submit", { provider: name })}
        </Button>
        {pending ? (
          <p role="status" aria-live="polite" className="text-meta text-muted-foreground">
            {t(`connect.pending.${provider}`)}
          </p>
        ) : null}
      </div>
    </form>
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {onBack ? (
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("add.back")}>
              <ArrowLeft aria-hidden="true" />
            </Button>
          ) : null}
          {t("connect.title", { provider: name })}
        </DialogTitle>
        <DialogDescription>{isStripe && stripeConnectUrl ? t("connect.introStripeOauth") : t(`connect.intro.${provider}`)}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {incomplete.length > 0 ? (
          <InlineAlert title={t("connect.resumeTitle")} className="mb-4">
            <p>{t("connect.resumeBody", { count: incomplete.length, names: incomplete.map((item) => item.label).join(", ") })}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {incomplete.map((item) => (
                <li key={item.id}>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={{ pathname: "/[workspaceSlug]/integrations/[connectionId]", params: { workspaceSlug, connectionId: item.id } }}>
                      {incomplete.length > 1 ? `${t("connect.resume")} · ${item.label}` : t("connect.resume")}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}
        {isStripe && stripeConnectUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Button asChild>
                <a href={stripeConnectUrl}>{t("connect.stripeOauth")}</a>
              </Button>
              <p className="text-meta text-muted-foreground">{t("connect.oauthHint")}</p>
            </div>
            {/* The manual path stays, one fold away: authorization resolves
                the account and the events, so it leads (brief §20). */}
            <details className="group border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-caption text-foreground-secondary hover:text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden="true" />
                {t("connect.manualTitle")}
              </summary>
              <div className="space-y-4 pt-3">
                <p className="text-meta text-muted-foreground">{t("connect.manualHint")}</p>
                {form}
              </div>
            </details>
          </div>
        ) : (
          form
        )}
      </DialogBody>
    </>
  )
}
