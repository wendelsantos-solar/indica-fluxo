import { useTranslations } from "next-intl"

import { InlineAlert } from "@/components/feedback/inline-alert"

type ParticipationStatus = "pending" | "approved" | "rejected" | "suspended"
type ProgramStatus = "draft" | "active" | "paused" | "archived"

/**
 * Says plainly whether a referral link earns. The tracking ingest records a
 * click for any known code, but only credits it — creates or moves the
 * visitor's attribution — when the participation is `approved` **and** the
 * program is `active`. See `recordClick` in `src/server/services/tracking.ts`.
 *
 * Program status does not stop commissions on customers already attributed:
 * the billing webhook and the commission engine check the participation, not
 * the program. The program copy says so, rather than implying all earnings
 * stop.
 *
 * One notice at a time. A rejected or suspended participation is the blocker
 * that matters to this affiliate — reactivating the program would not change
 * it — so it wins; otherwise a non-active program is explained first.
 */
export function ParticipationNotice({
  status,
  programStatus,
  className,
}: {
  status: ParticipationStatus
  programStatus: ProgramStatus
  className?: string
}) {
  const t = useTranslations("portal.participation")
  const tp = useTranslations("portal.programStatus")

  if (status === "rejected" || status === "suspended" || programStatus === "active") {
    if (status === "approved") return null
    return (
      <InlineAlert tone="info" title={t(`${status}.title`)} className={className}>
        {t(`${status}.description`)}
      </InlineAlert>
    )
  }

  return (
    <InlineAlert tone="info" title={tp(`${programStatus}.title`)} className={className}>
      {tp(`${programStatus}.description`)}
    </InlineAlert>
  )
}

/** Whether a new click on this participation's link is credited right now. */
export function linkEarns(participation: {
  status: ParticipationStatus
  programStatus: ProgramStatus
}): boolean {
  return participation.status === "approved" && participation.programStatus === "active"
}
