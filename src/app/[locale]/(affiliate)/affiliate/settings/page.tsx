import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.settings")
  return { title: t("title") }
}

export default async function AffiliateSettingsPage() {
  const t = await getTranslations("portal.settings")
  const user = await requireUser()
  const participations = await withUser(user.id, (tx) =>
    listParticipationsForUser(tx, user.id),
  )

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="space-y-6">
        <Card>
          <CardHeader bordered>
            <div>
              <CardTitle>{t("account.title")}</CardTitle>
              <CardDescription>{t("account.description")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-label uppercase tracking-[0.02em] text-muted-foreground">
                  {t("account.name")}
                </dt>
                <dd className="text-caption text-foreground">
                  {participations[0]?.affiliateName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-label uppercase tracking-[0.02em] text-muted-foreground">
                  {t("account.email")}
                </dt>
                <dd className="text-caption text-foreground">{user.email}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader bordered>
            <div>
              <CardTitle>{t("programs.title")}</CardTitle>
              <CardDescription>{t("programs.description")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {participations.map((participation) => (
                <li
                  key={participation.participationId}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="text-caption text-foreground">{participation.programName}</span>
                  <code className="font-mono text-meta text-muted-foreground">
                    {participation.code}
                  </code>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
