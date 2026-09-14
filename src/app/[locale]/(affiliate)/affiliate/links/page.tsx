import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { ReferralLinkField } from "@/components/data-display/copy-button"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { CreateLinkForm } from "@/features/affiliates/create-link-form"
import { getFormatters } from "@/i18n/format"
import { buildReferralUrl } from "@/lib/tracking/visitor"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listLinks, listParticipationsForUser } from "@/server/repositories/affiliates"

import { DefaultReferralLink } from "../_components/default-link"
import { linkEarns, ParticipationNotice } from "../_components/participation-notice"
import { PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.links")
  return { title: t("title") }
}

/**
 * Where a named link's URL comes from. The tracker on the program's site reads
 * the affiliate's code from `ref` (REF_QUERY_PARAMS) and posts `location.href`;
 * `recordClick` then attributes the click to the named link whose code is in
 * `link` (see `findLinkId` in `src/server/services/tracking.ts`). So a named
 * link is its destination plus both parameters, built with the same helper as
 * the default link.
 */
function namedLinkUrl(destinationUrl: string, participationCode: string, linkCode: string) {
  return buildReferralUrl(buildReferralUrl(destinationUrl, participationCode), linkCode, "link")
}

/**
 * One section per program: the default link first (the thing most affiliates
 * came to copy), then the named links as a compact list — each with its full
 * URL, a copy button and its clicks — and a quiet "Criar link" that opens the
 * form only when asked.
 */
export default async function AffiliateLinksPage() {
  const t = await getTranslations("portal.links")
  const f = await getFormatters()
  const user = await requireUser()

  const data = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    return Promise.all(
      participations.map(async (participation) => ({
        participation,
        links: await listLinks(tx, participation.participationId),
      })),
    )
  })

  // The one amber copy button: the first default link that exists and earns.
  const featuredId = data.find(
    ({ participation }) => linkEarns(participation) && participation.programWebsiteUrl,
  )?.participation.participationId

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="space-y-12">
        {data.map(({ participation, links }) => (
          <section key={participation.participationId} className="space-y-5">
            <SectionHeader
              title={participation.programName}
              action={
                participation.status === "approved" ? undefined : (
                  <StatusBadge status={participation.status} className="mt-1.5" />
                )
              }
              className="mb-0"
            />

            <ParticipationNotice
              status={participation.status}
              programStatus={participation.programStatus}
            />

            <div className="space-y-2">
              <p className="text-meta font-medium text-muted-foreground">{t("defaultLink")}</p>
              <DefaultReferralLink
                websiteUrl={participation.programWebsiteUrl}
                code={participation.code}
                prominent={participation.participationId === featuredId}
              />
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-2 text-meta font-medium text-muted-foreground">
                {t("namedLinks")}
                {links.length > 0 ? (
                  <span className="font-normal tabular-nums">{f.number(links.length)}</span>
                ) : null}
              </p>

              {links.length > 0 ? (
                <PortalList>
                  {links.map((link) => (
                    <PortalListItem
                      key={link.id}
                      title={link.name}
                      amount={
                        <span className="text-caption font-normal text-muted-foreground">
                          {t("clicks", { count: link.clicks })}
                        </span>
                      }
                      details={
                        link.campaign ? t("campaignLabel", { campaign: link.campaign }) : undefined
                      }
                    >
                      <ReferralLinkField
                        compact
                        url={namedLinkUrl(link.destinationUrl, participation.code, link.code)}
                        copyLabel={t("copyLink", { name: link.name })}
                      />
                    </PortalListItem>
                  ))}
                </PortalList>
              ) : (
                <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">
                  {t("namedLinksEmpty")}
                </p>
              )}
            </div>

            <CreateLinkForm participationId={participation.participationId} />
          </section>
        ))}
      </div>
    </>
  )
}
