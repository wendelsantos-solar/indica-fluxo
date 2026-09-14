import { Skeleton } from "@/components/ui/skeleton"

import { PortalHeaderSkeleton } from "../_components/skeletons"

/** Shaped like the overview: greeting, the earnings strip, then the referral link. */
export default function AffiliateOverviewLoading() {
  return (
    <>
      <PortalHeaderSkeleton description={false} />
      <div aria-busy="true" className="space-y-10">
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-1 gap-x-6 border-y border-border sm:grid-cols-2">
            <div className="space-y-2 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-40" />
            </div>
            <div className="space-y-2 border-t border-border-faint py-4 sm:border-t-0">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-40" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 flex-1 rounded-control sm:h-8" />
            <Skeleton className="h-11 rounded-control sm:h-8 sm:w-24" />
          </div>
        </div>
      </div>
    </>
  )
}
