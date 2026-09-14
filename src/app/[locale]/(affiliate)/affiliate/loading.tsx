import { PortalHeaderSkeleton, PortalListSkeleton } from "./_components/skeletons"

/** Links, conversions, commissions, payouts and settings: a header and a list. */
export default function AffiliatePortalLoading() {
  return (
    <>
      <PortalHeaderSkeleton />
      <div aria-busy="true">
        <PortalListSkeleton />
      </div>
    </>
  )
}
