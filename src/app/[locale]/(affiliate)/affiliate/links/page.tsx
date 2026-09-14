import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { ReferralLinkField } from "@/components/data-display/copy-button"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CreateLinkForm } from "@/features/affiliates/create-link-form"
import { getFormatters } from "@/i18n/format"
import { buildReferralUrl } from "@/lib/tracking/visitor"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listLinks, listParticipationsForUser } from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.links")
  return { title: t("title") }
}

/**
 * One block per program: the default link first (the thing most affiliates
 * came to copy), the named links beneath it — a table from `md`, stacked rows
 * on a phone — and the form to add another.
 */
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

  const linkCount = data.reduce((sum, entry) => sum + entry.links.length, 0)

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={linkCount > 0 ? <span>{f.number(linkCount)}</span> : undefined}
        description={t("description")}
      />

      <div className="space-y-12">
        {data.map(({ participation, links }, index) => (
          <section key={participation.participationId} className="space-y-4">
            <SectionHeader
              title={participation.programName}
              count={links.length > 0 ? f.number(links.length) : undefined}
            />

            <Card>
              <CardContent className="space-y-2">
                <p className="text-meta text-muted-foreground">{t("defaultLink")}</p>
                <ReferralLinkField
                  url={buildReferralUrl(appUrl, participation.code)}
                  prominent={index === 0}
                />
              </CardContent>
            </Card>

            {links.length > 0 ? (
              <>
                <TableContainer scrollable className="hidden md:block">
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
                          <TD mono className="max-w-60 truncate" title={link.destinationUrl}>
                            {link.destinationUrl}
                          </TD>
                          <TD>{link.campaign ?? "—"}</TD>
                          <TD numeric>{f.number(link.clicks)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>

                <ul className="divide-y divide-border-faint border-y border-border md:hidden">
                  {links.map((link) => (
                    <li key={link.id} className="flex items-start justify-between gap-4 px-1 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-ui text-foreground">{link.name}</p>
                        <p className="truncate font-mono text-meta text-muted-foreground">
                          {link.destinationUrl}
                        </p>
                        {link.campaign ? (
                          <p className="truncate text-meta text-faint-foreground">
                            {link.campaign}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-ui tabular-nums text-foreground">
                          {f.number(link.clicks)}
                        </p>
                        <p className="text-meta text-muted-foreground">{tc("clicks")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <CreateLinkForm participationId={participation.participationId} />
          </section>
        ))}
      </div>
    </>
  )
}
