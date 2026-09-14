import { useTranslations } from "next-intl"

import { InlineAlert } from "@/components/feedback/inline-alert"

type ParticipationStatus = "pending" | "approved" | "rejected" | "suspended"

/**
 * Says plainly whether a referral link earns. The tracking ingest records a
 * click for any known code, but only credits it — and so only ever produces a
 * commission — when the participation is `approved` (and the program is
 * active). See `recordClick` in `src/server/services/tracking.ts`.
 */
export function ParticipationNotice({
  status,
  className,
}: {
  status: ParticipationStatus
  className?: string
}) {
  const t = useTranslations("portal.participation")

  if (status === "approved") return null

  return (
    <InlineAlert tone="info" title={t(`${status}.title`)} className={className}>
      {t(`${status}.description`)}
    </InlineAlert>
  )
}
