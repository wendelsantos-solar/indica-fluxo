import { Lock, ScrollText } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { EmptyState } from "@/components/feedback/empty-state"
import { SectionHeader } from "@/components/layout/page-header"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { createFormatters } from "@/lib/money"
import { hasPlanFeature, planWithFeature, type PlanKey } from "@/lib/plans"
import type { AuditLogEntry } from "@/server/services/audit"

/** A zone stored before validation existed must not take the page down. */
function dateTimeFormat(locale: string, timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
  }
}

/**
 * Settings → Audit log. On a plan with `auditLog` it lists the recent entries;
 * otherwise it explains the feature is part of Growth. Owners and admins only —
 * render it for them alone.
 *
 * Load entries with `listAuditLog(user.id, workspace.id)` from
 * `@/server/services/audit` only when `hasPlanFeature(plan, "auditLog")`; it
 * throws `PlanFeatureError` otherwise. Pass `[]` when locked.
 */
export function AuditLogPanel({
  plan,
  entries,
  currentUserId,
  timeZone,
}: {
  plan: PlanKey
  entries: AuditLogEntry[]
  currentUserId: string
  /** The workspace's IANA zone; times are shown in it. */
  timeZone: string
}) {
  const t = useTranslations("plans.audit")
  const tn = useTranslations("plans.names")
  const locale = useLocale()
  const f = createFormatters(locale)
  const locked = !hasPlanFeature(plan, "auditLog")

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
        <TableContainer>
          <EmptyState
            icon={Lock}
            title={t("locked.title", { plan: tn(planWithFeature("auditLog")) })}
            description={t("locked.description", { plan: tn(planWithFeature("auditLog")) })}
            className="py-10"
          />
        </TableContainer>
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
