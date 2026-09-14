import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { ReferralLinkField } from "@/components/data-display/copy-button"
import { getFormatters } from "@/i18n/format"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CreateLinkForm } from "@/features/affiliates/create-link-form"
import { buildReferralUrl } from "@/lib/tracking/visitor"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listLinks, listParticipationsForUser } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.links")
  return { title: t("title") }
}

export default async function AffiliateLinksPage() {
  const t = await getTranslations("portal.links")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com"

  const data = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    const links = await Promise.all(
      participations.map(async (participation) => ({
        participation,
        links: await listLinks(tx, participation.participationId),
      })),
    )
    return links
  })

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-8">
        {data.map(({ participation, links }) => (
          <section key={participation.participationId}>
            <SectionHeader title={participation.programName} />

            <Card className="mb-3">
              <CardContent className="space-y-2">
                <p className="text-meta text-muted-foreground">{t("defaultLink")}</p>
                <ReferralLinkField url={buildReferralUrl(appUrl, participation.code)} />
              </CardContent>
            </Card>

            {links.length > 0 ? (
              <TableContainer scrollable className="mb-3">
                <Table>
                  <THead>
                    <tr>
                      <TH>{tc("name")}</TH>
                      <TH>{t("destination")}</TH>
                      <TH>{t("campaign")}</TH>
                      <TH numeric>{tc("clicks")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {links.map((link) => (
                      <TR key={link.id}>
                        <TD className="text-foreground">{link.name}</TD>
                        <TD mono className="max-w-[240px] truncate">
                          {link.destinationUrl}
                        </TD>
                        <TD>{link.campaign ?? "—"}</TD>
                        <TD numeric>{f.number(link.clicks)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            ) : null}

            <CreateLinkForm participationId={participation.participationId} />
          </section>
        ))}
      </div>
    </>
  )
}
