import { DetailPageSkeleton } from "@/components/feedback/page-skeleton"

/** An affiliate's detail shape: breadcrumb bar, identity, four metrics, a table. */
export default function AffiliateDetailLoading() {
  return <DetailPageSkeleton metrics={4} />
}
