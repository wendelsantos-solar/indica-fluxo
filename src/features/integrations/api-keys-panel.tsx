"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { Button } from "@/components/ui/button"
import { useFormatters } from "@/i18n/use-formatters"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"

import { rotateKeyAction, type IntegrationFormState } from "./actions"

const INITIAL: IntegrationFormState = {}

export interface ApiKeyRow {
  id: string
  name: string
  type: "publishable" | "secret"
  keyPrefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export function ApiKeysPanel({
  workspaceSlug,
  keys,
  snippet,
}: {
  workspaceSlug: string
  keys: ApiKeyRow[]
  snippet: string
}) {
  const t = useTranslations("forms.apiKeys")
  const tc = useTranslations("common.table")
  const f = useFormatters()
  const [state, rotate, rotating] = useActionState(rotateKeyAction, INITIAL)
  const active = keys.filter((key) => !key.revokedAt)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-caption font-medium text-foreground">{t("title")}</h2>
        <p className="mt-0.5 max-w-[68ch] text-caption text-muted-foreground">
          {t.rich("description", {
            code: (chunks) => <code className="font-mono text-meta">{chunks}</code>,
          })}
        </p>
      </div>

      {state.revealedKey ? (
        <div
          role="status"
          className="space-y-2 rounded-control border border-warning/40 bg-warning-subtle p-3"
        >
          <p className="text-meta font-medium text-warning-foreground">{t("revealWarning")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-meta text-foreground">
              {state.revealedKey}
            </code>
            <CopyButton value={state.revealedKey} />
          </div>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {state.error}
        </p>
      ) : null}

      <TableContainer>
        <Table>
          <THead>
            <tr>
              <TH>{t("key")}</TH>
              <TH>{t("type")}</TH>
              <TH className="max-sm:hidden">{t("lastUsed")}</TH>
              <TH className="text-right">
                <span className="sr-only">{tc("actions")}</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {active.map((key) => (
              <TR key={key.id}>
                <TD mono>{key.keyPrefix}…</TD>
                <TD>{key.type === "secret" ? t("typeSecret") : t("typePublishable")}</TD>
                <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">
                  {key.lastUsedAt ? f.date(key.lastUsedAt) : t("neverUsed")}
                </TD>
                <TD>
                  <form action={rotate} className="flex justify-end">
                    <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                    <input type="hidden" name="type" value={key.type} />
                    <Button type="submit" variant="ghost" size="sm" loading={rotating}>
                      {t("rotate")}
                    </Button>
                  </form>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>

      <div className="space-y-1.5 pt-2">
        <p className="text-meta font-medium text-muted-foreground">{t("snippet")}</p>
        <div className="flex items-start gap-2 rounded-control border border-border bg-fill-subtle py-1.5 pl-2.5 pr-1.5">
          <code className="min-w-0 flex-1 break-all py-1 font-mono text-meta text-foreground-secondary">
            {snippet}
          </code>
          <CopyButton value={snippet} />
        </div>
        <p className="text-meta text-faint-foreground">
          {t.rich("snippetHint", {
            // An HTML tag cannot sit inside an ICU message, so it is a value.
            head: "</head>",
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </p>
      </div>
    </section>
  )
}
