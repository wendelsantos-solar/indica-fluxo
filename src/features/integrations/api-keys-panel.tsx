"use client"

import { useActionState } from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
  const [state, rotate, rotating] = useActionState(rotateKeyAction, INITIAL)
  const active = keys.filter((key) => !key.revokedAt)

  return (
    <Card>
      <CardHeader bordered>
        <div>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            The publishable key goes in your tracking snippet. The secret key is for
            server-to-server calls to <code className="font-mono">/api/identify</code> only.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {state.revealedKey ? (
          <div className="space-y-2 rounded-[6px] border border-border bg-warning-subtle p-3">
            <p className="text-[12px] font-medium text-warning-foreground">
              Copy this key now — it will never be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">
                {state.revealedKey}
              </code>
              <CopyButton value={state.revealedKey} />
            </div>
          </div>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-[12px] text-danger-foreground">
            {state.error}
          </p>
        ) : null}

        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Key</TH>
                <TH>Type</TH>
                <TH>Last used</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {active.map((key) => (
                <TR key={key.id}>
                  <TD mono>{key.keyPrefix}…</TD>
                  <TD>{key.type === "secret" ? "Secret" : "Publishable"}</TD>
                  <TD className="text-muted-foreground">
                    {key.lastUsedAt ? key.lastUsedAt.toISOString().slice(0, 10) : "Never"}
                  </TD>
                  <TD>
                    <form action={rotate} className="flex justify-end">
                      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                      <input type="hidden" name="type" value={key.type} />
                      <Button type="submit" variant="ghost" size="sm" loading={rotating}>
                        Rotate
                      </Button>
                    </form>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>

        <div>
          <p className="mb-2 text-[13px] font-medium">Tracking snippet</p>
          <div className="flex items-start gap-2 rounded-[6px] border border-border bg-surface-2 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-foreground-secondary">
              {snippet}
            </code>
            <CopyButton value={snippet} />
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Paste it before <code className="font-mono">&lt;/head&gt;</code> on the site your
            affiliates link to. It sets a first-party cookie and reports the referral code.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
