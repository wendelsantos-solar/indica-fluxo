import { ListPageSkeleton } from "@/components/feedback/page-skeleton"

/**
 * Shown the moment a sidebar item is clicked, while the server renders the
 * page. Most dashboard pages are a header, a filter row and a list.
 */
export default function DashboardLoading() {
  return <ListPageSkeleton />
}
