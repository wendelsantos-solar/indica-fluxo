import { useTranslations } from "next-intl"

import { StatusBadge } from "@/components/ui/badge"

type ParticipationStatus = "pending" | "approved" | "rejected" | "suspended"
type PayoutItemStatus = "pending" | "paid" | "failed" | "cancelled"
type CommissionStatus = "pending" | "available" | "approved" | "paid" | "reversed" | "rejected"

/**
 * The portal's status words, aligned with what the program owner reads for
 * the same record, so affiliate and founder can talk about one status with one
 * word. The tone still comes from `StatusBadge`.
 */

/** Participation: "Aprovado / Pendente / Suspenso / Recusado", as on the owner's Afiliados page. */
export function ParticipationBadge({ status, className }: { status: ParticipationStatus; className?: string }) {
  const t = useTranslations("portal.participationStatus")
  return <StatusBadge status={status} label={t(status)} className={className} />
}

/** Payout: "Pago / Aguardando pagamento / Cancelado", as on the owner's batch page. */
export function PayoutBadge({ status }: { status: PayoutItemStatus }) {
  const t = useTranslations("portal.payouts.status")
  return <StatusBadge status={status} label={t(status)} />
}

/** Commission: the portal's own words, defined once in the Comissões legend. */
export function CommissionBadge({ status }: { status: CommissionStatus }) {
  const t = useTranslations("portal.commissions.status")
  return <StatusBadge status={status} label={t(status)} />
}
