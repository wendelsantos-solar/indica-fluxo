"use client"

import { useTranslations } from "next-intl"
import * as React from "react"

import { Select } from "@/components/ui/input"
import { useRouter } from "@/i18n/navigation"

import {
  COMMISSION_STATUSES,
  commissionFilterQuery,
  type CommissionFilterValues,
  type PortalCommissionStatus,
} from "./commission-filters-params"

/**
 * Status and program filters that apply as soon as a value is picked — no
 * "Aplicar" button. Changing a filter goes back to page 1; the URL is the
 * state, so a filtered view can be bookmarked and survives a reload.
 */
export function CommissionFilters({
  programs,
  values,
}: {
  programs: { id: string; name: string }[]
  values: CommissionFilterValues
}) {
  const t = useTranslations("portal.commissions")
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function apply(next: CommissionFilterValues) {
    startTransition(() => {
      router.replace({ pathname: "/affiliate/commissions", query: commissionFilterQuery(next) }, { scroll: false })
    })
  }

  return (
    <div
      role="group"
      aria-label={t("filters.label")}
      aria-busy={pending || undefined}
      className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <label className="sr-only" htmlFor="commission-status-filter">
        {t("filters.status")}
      </label>
      <Select
        id="commission-status-filter"
        value={values.status ?? ""}
        onChange={(event) =>
          apply({ ...values, status: (event.target.value || undefined) as PortalCommissionStatus | undefined })
        }
        className="sm:w-48"
      >
        <option value="">{t("filters.allStatuses")}</option>
        {COMMISSION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`status.${status}`)}
          </option>
        ))}
      </Select>

      {programs.length > 1 ? (
        <>
          <label className="sr-only" htmlFor="commission-program-filter">
            {t("filters.program")}
          </label>
          <Select
            id="commission-program-filter"
            value={values.programId ?? ""}
            onChange={(event) => apply({ ...values, programId: event.target.value || undefined })}
            className="sm:w-56"
          >
            <option value="">{t("filters.allPrograms")}</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </div>
  )
}
