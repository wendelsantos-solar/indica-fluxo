"use client"

import { KeyRound } from "lucide-react"
import { useTranslations } from "next-intl"
import type * as React from "react"
import { useState } from "react"
import { useFormStatus } from "react-dom"

import { EmptyState } from "@/components/feedback/empty-state"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Link } from "@/i18n/navigation"
import { useFormatters } from "@/i18n/use-formatters"

import { rotateKeyAction, type IntegrationFormState } from "./actions"
import { CodeField } from "./code-field"

const INITIAL: IntegrationFormState = {}
const TYPES = ["publishable", "secret"] as const
type KeyType = (typeof TYPES)[number]
type KeyEnvironment = "test" | "live"

export interface ApiKeyRow {
  id: string
  name: string
  type: KeyType
  environment: KeyEnvironment
  keyPrefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/**
 * API keys, per environment, and the tracking code that uses a public one.
 *
 * Test keys (`pk_test_`/`sk_test_`) reach test programs only and work on every
 * plan; live keys reach live programs and need a plan with live mode, so a
 * Sandbox workspace sees the live section locked with a way to Settings → Plan.
 *
 * Only a key's prefix and hash are stored, so the full tracking code can exist
 * on this page exactly once: right after a key is generated. Before that the
 * code is shown with its key visibly missing and no copy button — copying it
 * would install a snippet that silently records nothing.
 */
export function ApiKeysPanel({
  workspaceSlug,
  keys,
  liveModeAvailable,
  trackerUrl,
  lastClickWhen,
}: {
  workspaceSlug: string
  keys: ApiKeyRow[]
  /** Whether the plan allows live keys (live mode in good standing). */
  liveModeAvailable: boolean
  /** Absolute URL of the tracker script. */
  trackerUrl: string
  /** Pre-formatted on the server ("há 5 minutos"); `null` when no click was ever recorded. */
  lastClickWhen: string | null
}) {
  const t = useTranslations("forms.apiKeys")
  const [result, setResult] = useState<{ type: KeyType; environment: KeyEnvironment; state: IntegrationFormState } | null>(
    null,
  )
  // The public key outlives a later secret-key generation: the tracking code
  // built from it stays on screen for as long as this page is open.
  const [publishableKey, setPublishableKey] = useState<string | null>(null)

  const active = keys.filter((key) => !key.revokedAt)
  const activeOf = (environment: KeyEnvironment, type: KeyType) =>
    active.find((key) => key.environment === environment && key.type === type)
  // The environment the tracking code is built for: live once the plan has it.
  const snippetEnvironment: KeyEnvironment = liveModeAvailable ? "live" : "test"

  async function generate(formData: FormData) {
    const type: KeyType = formData.get("type") === "secret" ? "secret" : "publishable"
    const environment: KeyEnvironment = formData.get("environment") === "live" ? "live" : "test"
    const state = await rotateKeyAction(INITIAL, formData)
    setResult({ type, environment, state })
    if (type === "publishable" && state.revealedKey) setPublishableKey(state.revealedKey)
  }

  const action = (
    environment: KeyEnvironment,
    type: KeyType,
    variant: ButtonProps["variant"] = "danger",
    label?: string,
  ) => (
    <KeyAction
      type={type}
      environment={environment}
      exists={Boolean(activeOf(environment, type))}
      workspaceSlug={workspaceSlug}
      onGenerate={generate}
      variant={variant}
      label={label}
    />
  )

  const outcome = (environment: KeyEnvironment) => {
    if (result?.environment !== environment) return null
    if (result.state.error) {
      return (
        <InlineAlert tone="danger" className="mb-3">
          {result.state.error}
        </InlineAlert>
      )
    }
    if (!result.state.revealedKey) return null
    return (
      <div className="mb-3 space-y-2">
        <InlineAlert tone="success" title={t("revealTitle", { type: result.type, environment })}>
          {t("revealWarning")}
        </InlineAlert>
        <CodeField copyValue={result.state.revealedKey}>{result.state.revealedKey}</CodeField>
      </div>
    )
  }

  const snippetStart = `<script defer src="${trackerUrl}" data-key="`
  const snippetEnd = `"></script>`

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader
          title={t("title")}
          description={t.rich("description", {
            code: (chunks) => <code className="font-mono text-meta">{chunks}</code>,
          })}
          className="mb-6"
        />

        <div className="space-y-6">
          <div>
            <EnvironmentHeading environment="test" />
            {outcome("test")}
            {active.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title={t("empty.title")}
                description={t("empty.description")}
                action={action("test", "publishable", "secondary", t("empty.action"))}
                className="border-y border-border py-12"
              />
            ) : (
              <KeyTable environment="test" activeOf={activeOf} action={action} />
            )}
          </div>

          <div>
            <EnvironmentHeading environment="live" />
            {outcome("live")}
            {liveModeAvailable ? (
              <KeyTable environment="live" activeOf={activeOf} action={action} />
            ) : (
              <InlineAlert
                title={t("liveLocked.title")}
                action={
                  <Link
                    href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t("liveLocked.action")}
                  </Link>
                }
              >
                {t("liveLocked.description")}
              </InlineAlert>
            )}
          </div>
        </div>
      </section>

      <section id="tracking" className="scroll-mt-16">
        <SectionHeader
          title={t("snippet")}
          description={t.rich("snippetHint", {
            // An HTML tag cannot sit inside an ICU message, so it is a value.
            head: "</head>",
            code: (chunks) => <code className="font-mono text-meta">{chunks}</code>,
          })}
          className="mb-3"
        />

        {/* Evidence the installed code works, independent of whether a full key is on screen. */}
        <p className="mb-3 text-meta text-muted-foreground">
          {lastClickWhen ? t("lastClick", { when: lastClickWhen }) : t("noClicks")}
        </p>

        {publishableKey ? (
          <div className="space-y-2">
            <CodeField copyValue={`${snippetStart}${publishableKey}${snippetEnd}`}>
              {snippetStart}
              {publishableKey}
              {snippetEnd}
            </CodeField>
            <p className="text-meta text-muted-foreground">{t("snippetReady")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <CodeField>
              {snippetStart}
              <mark className="rounded-badge border border-dashed border-border-strong bg-transparent px-1 text-foreground">
                {t("keyPlaceholder")}
              </mark>
              {snippetEnd}
            </CodeField>
            {/* With no key at all, the key section above already offers
                "Gerar chave pública" as the first step; a second identical
                button here would compete with it. */}
            <InlineAlert
              action={
                active.length === 0
                  ? undefined
                  : action(
                      snippetEnvironment,
                      "publishable",
                      "secondary",
                      activeOf(snippetEnvironment, "publishable") ? t("generatePublishable") : t("empty.action"),
                    )
              }
            >
              {activeOf(snippetEnvironment, "publishable")
                ? t("snippetLocked")
                : active.length === 0
                  ? t("snippetFirstStep")
                  : t("snippetNoKey")}
            </InlineAlert>
          </div>
        )}
      </section>
    </div>
  )
}

function EnvironmentHeading({ environment }: { environment: KeyEnvironment }) {
  const t = useTranslations("forms.apiKeys.environments")
  return (
    <div className="mb-3">
      <h3 className="text-caption font-medium text-foreground">{t(`${environment}.title`)}</h3>
      <p className="mt-1 max-w-prose text-caption text-muted-foreground">{t(`${environment}.description`)}</p>
    </div>
  )
}

function KeyTable({
  environment,
  activeOf,
  action,
}: {
  environment: KeyEnvironment
  activeOf: (environment: KeyEnvironment, type: KeyType) => ApiKeyRow | undefined
  action: (environment: KeyEnvironment, type: KeyType, variant?: ButtonProps["variant"]) => React.ReactNode
}) {
  const t = useTranslations("forms.apiKeys")
  const tc = useTranslations("common.table")
  const f = useFormatters()

  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH>{t("key")}</TH>
            <TH>{t("type")}</TH>
            <TH className="max-sm:hidden">{t("lastUsed")}</TH>
            <TH className="text-right">{tc("actions")}</TH>
          </tr>
        </THead>
        <TBody>
          {TYPES.map((type) => {
            const key = activeOf(environment, type)
            return (
              <TR key={type}>
                <TD mono className={key ? undefined : "text-muted-foreground"}>
                  {key ? `${key.keyPrefix}…` : t("noKey")}
                </TD>
                <TD>{type === "secret" ? t("typeSecret") : t("typePublishable")}</TD>
                <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">
                  {key ? (key.lastUsedAt ? f.date(key.lastUsedAt) : t("neverUsed")) : "—"}
                </TD>
                <TD>
                  <div className="flex justify-end">{action(environment, type, key ? "danger" : "secondary")}</div>
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </TableContainer>
  )
}

/**
 * Generating a key revokes the current one of the same type and environment,
 * which breaks whatever uses it — so an existing key is replaced only behind a
 * confirmation that says what stops working. A slot with no active key has
 * nothing to break.
 */
function KeyAction({
  type,
  environment,
  exists,
  workspaceSlug,
  onGenerate,
  variant,
  label,
}: {
  type: KeyType
  environment: KeyEnvironment
  exists: boolean
  workspaceSlug: string
  onGenerate: (formData: FormData) => Promise<void>
  variant: ButtonProps["variant"]
  label?: string
}) {
  const t = useTranslations("forms.apiKeys")
  const fields = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="environment" value={environment} />
    </>
  )

  if (!exists) {
    return (
      <form action={onGenerate}>
        {fields}
        <SubmitButton variant={variant}>{label ?? t("generate")}</SubmitButton>
      </form>
    )
  }

  return (
    <ConfirmDialog
      trigger={label ?? t("rotate")}
      triggerVariant={variant}
      title={t("confirmTitle", { type, environment })}
      description={type === "secret" ? t("confirmSecret") : t("confirmPublishable")}
      confirmLabel={t("confirmAction")}
      action={onGenerate}
    >
      {fields}
    </ConfirmDialog>
  )
}

function SubmitButton({ variant, children }: { variant: ButtonProps["variant"]; children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} size="sm" loading={pending}>
      {children}
    </Button>
  )
}
