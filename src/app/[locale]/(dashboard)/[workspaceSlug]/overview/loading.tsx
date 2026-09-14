import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"

import { OverviewSkeleton } from "./overview-skeleton"

/** Navigation feedback shaped like the overview: metrics, chart and funnel, tables. */
export default async function OverviewLoading() {
  const t = await getTranslations("dashboard.overview")

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <OverviewSkeleton />
    </>
  )
}
