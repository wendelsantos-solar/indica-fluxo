"use client"

import { Coins, MoreHorizontal, UserRound } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown"
import { Link } from "@/i18n/navigation"

/**
 * Row menu on a program's affiliates tab: where to go next about one person —
 * their page, or their commissions in this program. Navigation only; status
 * and rate changes live on the affiliate list and page.
 */
export function ProgramAffiliateActions({
  workspaceSlug,
  affiliateId,
  affiliateName,
  programId,
}: {
  workspaceSlug: string
  affiliateId: string
  affiliateName: string
  programId: string
}) {
  const t = useTranslations("dashboard.program.affiliateActions")

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("menuLabel", { name: affiliateName })}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem asChild>
          <Link
            href={{
              pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
              params: { workspaceSlug, affiliateId },
            }}
          >
            <UserRound aria-hidden="true" />
            {t("viewAffiliate")}
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link
            href={{
              pathname: "/[workspaceSlug]/commissions",
              params: { workspaceSlug },
              query: { affiliate: affiliateId, program: programId },
            }}
          >
            <Coins aria-hidden="true" />
            {t("viewCommissions")}
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
