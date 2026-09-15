import { ScrollText } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { EmptyState } from "@/components/feedback/empty-state"
import { SectionHeader } from "@/components/layout/page-header"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { createFormatters } from "@/lib/money"
import type { PlanCode } from "@/lib/plans"
import type { AuditLogEntry } from "@/server/services/audit"

import { UpgradePrompt } from "./upgrade-prompt"

/** A zone stored before validation existed must not take the page down. */
function dateTimeFormat(locale: string, timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
  }
}

/**
 * Settings → Registro de auditoria. With the `auditLog` feature it lists the
 * recent entries; otherwise the upgrade prompt says which plan has it (the
 * trail keeps recording meanwhile — docs/PLANS.md §6). Owners and admins only —
 * render it for them alone.
 *
 * Load entries with `listAuditLog(user.id, workspace.id)` from
 * `@/server/services/audit` only when `entitlements.capabilities.features.auditLog`;
 * it throws `FeatureNotAvailableError` otherwise. Pass `[]` when locked.
 */
export function AuditLogPanel({
  available,
  subscribedPlan,
  workspaceSlug,
  entries,
  currentUserId,
  timeZone,
}: {
  /** The plan includes `auditLog`. */
  available: boolean
  /** For the upgrade prompt: the offer is above it. */
  subscribedPlan: PlanCode
  workspaceSlug: string
  entries: AuditLogEntry[]
  currentUserId: string
  /** The workspace's IANA zone; times are shown in it. */
  timeZone: string
}) {
  const t = useTranslations("plans.audit")
  const locale = useLocale()
  const f = createFormatters(locale)
  const locked = !available

  const when = dateTimeFormat(locale, timeZone)

  const actor = (entry: AuditLogEntry) => {
    if (!entry.actorUserId) return t("actor.system")
    if (entry.actorUserId === currentUserId) return t("actor.you")
    return entry.actorName ?? t("actor.member", { id: entry.actorUserId.slice(0, 8) })
  }

  const action = (entry: AuditLogEntry) =>
    t.has(`actions.${entry.action}`) ? t(`actions.${entry.action}`) : entry.action

  return (
    <section>
      <SectionHeader
        title={t("title")}
        count={locked ? undefined : f.number(entries.length)}
        description={locked ? undefined : t("description", { count: entries.length })}
        className="mb-3"
      />

      {locked ? (
        <div className="space-y-3">
          <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">{t("locked.summary")}</p>
          <UpgradePrompt reason="auditLog" workspaceSlug={workspaceSlug} currentPlan={subscribedPlan} />
        </div>
      ) : entries.length === 0 ? (
        <TableContainer>
          <EmptyState icon={ScrollText} title={t("empty.title")} description={t("empty.description")} className="py-10" />
        </TableContainer>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>{t("columns.action")}</TH>
                <TH className="max-sm:hidden">{t("columns.actor")}</TH>
                <TH className="max-sm:hidden" numeric>
                  {t("columns.when")}
                </TH>
              </tr>
            </THead>
            <TBody>
              {entries.map((entry) => (
                <TR key={entry.id}>
                  <TD className="max-sm:py-2.5">
                    <span className="block text-foreground">{action(entry)}</span>
                    <span className="block text-meta text-muted-foreground sm:hidden">
                      {t("mobileMeta", { actor: actor(entry), when: when.format(entry.createdAt) })}
                    </span>
                  </TD>
                  <TD className="max-sm:hidden">
                    <span className="block truncate">{actor(entry)}</span>
                  </TD>
                  <TD numeric className="text-muted-foreground max-sm:hidden">
                    <time dateTime={entry.createdAt.toISOString()}>{when.format(entry.createdAt)}</time>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </section>
  )
}
