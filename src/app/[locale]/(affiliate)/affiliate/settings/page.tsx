import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { getFormatters } from "@/i18n/format"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

import { PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.settings")
  return { title: t("title") }
}

/**
 * Read-only: what the program owner has on record, and who to talk to about
 * changing it. Nothing here is editable, so nothing here pretends to be a form
 * or promises payout details the portal does not collect.
 */
export default async function AffiliateSettingsPage() {
  const t = await getTranslations("portal.settings")
  const f = await getFormatters()
  const user = await requireUser()
  const participations = await withUser(user.id, (tx) =>
    listParticipationsForUser(tx, user.id),
  )

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div>
        <div className="max-w-detail space-y-10">
          <section>
            <SectionHeader title={t("account.title")} description={t("account.description")} />
            <dl className="divide-y divide-border-faint border-y border-border">
              <div className="flex flex-col gap-0.5 px-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <dt className="text-caption text-muted-foreground">{t("account.name")}</dt>
                <dd className="min-w-0 truncate text-caption text-foreground">
                  {participations[0]?.affiliateName ?? "—"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 px-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <dt className="text-caption text-muted-foreground">{t("account.email")}</dt>
                <dd className="min-w-0 truncate text-caption text-foreground">{user.email}</dd>
              </div>
            </dl>
          </section>

          <section>
            <SectionHeader
              title={t("programs.title")}
              count={f.number(participations.length)}
              description={t("programs.description")}
            />
            <PortalList>
              {participations.map((participation) => (
                <PortalListItem
                  key={participation.participationId}
                  title={participation.programName}
                  status={<StatusBadge status={participation.status} />}
                  details={t.rich("programs.code", {
                    code: participation.code,
                    mono: (chunks) => (
                      <span className="font-mono text-foreground-secondary">{chunks}</span>
                    ),
                  })}
                />
              ))}
            </PortalList>
          </section>
        </div>
      </div>
    </>
  )
}
