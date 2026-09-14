import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.settings")
  return { title: t("title") }
}

/**
 * Read-only profile: sections of label/value rows between hairlines, in a
 * detail-width column. Nothing here is a form, so nothing here is a card.
 */
export default async function AffiliateSettingsPage() {
  const t = await getTranslations("portal.settings")
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
            <SectionHeader title={t("account.title")} />
            <p className="mb-3 max-w-prose text-caption text-muted-foreground">
              {t("account.description")}
            </p>
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
            <SectionHeader title={t("programs.title")} count={participations.length} />
            <p className="mb-3 max-w-prose text-caption text-muted-foreground">
              {t("programs.description")}
            </p>
            <ul className="divide-y divide-border-faint border-y border-border">
              {participations.map((participation) => (
                <li
                  key={participation.participationId}
                  className="flex items-center justify-between gap-3 px-1 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-caption text-foreground">
                      {participation.programName}
                    </p>
                    <code className="block truncate font-mono text-meta text-muted-foreground">
                      {participation.code}
                    </code>
                  </div>
                  <StatusBadge status={participation.status} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
