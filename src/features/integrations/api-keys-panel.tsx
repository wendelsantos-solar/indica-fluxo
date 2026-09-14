"use client"

import { KeyRound } from "lucide-react"
import { useTranslations } from "next-intl"
import type * as React from "react"
import { useState } from "react"
import { useFormStatus } from "react-dom"

import { EmptyState } from "@/components/feedback/empty-state"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Button, type ButtonProps } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { useFormatters } from "@/i18n/use-formatters"

import { rotateKeyAction, type IntegrationFormState } from "./actions"
import { CodeField } from "./code-field"

const INITIAL: IntegrationFormState = {}
const TYPES = ["publishable", "secret"] as const
type KeyType = (typeof TYPES)[number]

export interface ApiKeyRow {
  id: string
  name: string
  type: KeyType
  keyPrefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/**
 * API keys and the tracking code that uses the public one.
 *
 * Only a key's prefix is stored, so the full tracking code can exist on this
 * page exactly once: right after a key is generated. Before that the code is
 * shown with its key visibly missing and no copy button — copying it would
 * install a snippet that silently records nothing — and generating a key is
 * the path offered instead.
 */
export function ApiKeysPanel({
  workspaceSlug,
  keys,
  trackerUrl,
}: {
  workspaceSlug: string
  keys: ApiKeyRow[]
  /** Absolute URL of the tracker script. */
  trackerUrl: string
}) {
  const t = useTranslations("forms.apiKeys")
  const tc = useTranslations("common.table")
  const f = useFormatters()
  const [result, setResult] = useState<{ type: KeyType; state: IntegrationFormState } | null>(null)
  // The public key outlives a later secret-key generation: the tracking code
  // built from it stays on screen for as long as this page is open.
  const [publishableKey, setPublishableKey] = useState<string | null>(null)

  const active = keys.filter((key) => !key.revokedAt)
  const activeOf = (type: KeyType) => active.find((key) => key.type === type)

  async function generate(formData: FormData) {
    const type: KeyType = formData.get("type") === "secret" ? "secret" : "publishable"
    const state = await rotateKeyAction(INITIAL, formData)
    setResult({ type, state })
    if (type === "publishable" && state.revealedKey) setPublishableKey(state.revealedKey)
  }

  const revealed = result?.state.revealedKey ? { type: result.type, key: result.state.revealedKey } : null
  const revealedPublishable = publishableKey

  const action = (type: KeyType, variant: ButtonProps["variant"] = "danger", label?: string) => (
    <KeyAction
      type={type}
      exists={Boolean(activeOf(type))}
      workspaceSlug={workspaceSlug}
      onGenerate={generate}
      variant={variant}
      label={label}
    />
  )

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
          className="mb-3"
        />

        {result?.state.error ? (
          <InlineAlert tone="danger" className="mb-3">
            {result.state.error}
          </InlineAlert>
        ) : null}
        {revealed ? (
          <div className="mb-3 space-y-2">
            <InlineAlert tone="success" title={t("revealTitle", { type: revealed.type })}>
              {t("revealWarning")}
            </InlineAlert>
            <CodeField copyValue={revealed.key}>{revealed.key}</CodeField>
          </div>
        ) : null}

        {active.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("empty.title")}
            description={t("empty.description")}
            action={action("publishable", "secondary", t("empty.action"))}
            className="border-y border-border py-12"
          />
        ) : (
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
                  const key = activeOf(type)
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
                        <div className="flex justify-end">{action(type, key ? "danger" : "secondary")}</div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </section>

      <section id="tracking">
        <SectionHeader
          title={t("snippet")}
          description={t.rich("snippetHint", {
            // An HTML tag cannot sit inside an ICU message, so it is a value.
            head: "</head>",
            code: (chunks) => <code className="font-mono text-meta">{chunks}</code>,
          })}
          className="mb-3"
        />

        {revealedPublishable ? (
          <div className="space-y-2">
            <CodeField copyValue={`${snippetStart}${revealedPublishable}${snippetEnd}`}>
              {snippetStart}
              {revealedPublishable}
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
            <InlineAlert
              action={action(
                "publishable",
                "secondary",
                activeOf("publishable") ? t("generatePublishable") : t("empty.action"),
              )}
            >
              {activeOf("publishable") ? t("snippetLocked") : t("snippetNoKey")}
            </InlineAlert>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Generating a key revokes the current one of the same type, which breaks
 * whatever uses it — so an existing key is replaced only behind a confirmation
 * that says what stops working. A type with no active key has nothing to break.
 */
function KeyAction({
  type,
  exists,
  workspaceSlug,
  onGenerate,
  variant,
  label,
}: {
  type: KeyType
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
      title={t("confirmTitle", { type })}
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
