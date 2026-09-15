import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/**
 * Payouts' shape: header bar and description line, the three-figure strip,
 * then the payable list and the batch history, each under its section title.
 */
export default function PayoutsLoading() {
  return (
    <>
      <div
        data-page-header
        className="sticky top-12 z-sticky -mx-4 mb-5 flex min-h-12 items-center border-b border-border bg-surface-1 px-4 md:top-0 md:-mx-6 md:px-6"
      >
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div className="mb-6">
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>

      <div aria-busy="true" className="space-y-10">
        <div className="grid grid-cols-2 gap-x-6 border-y border-border sm:grid-cols-3">
          <MetricSkeleton />
          <MetricSkeleton />
          <div className="max-sm:col-span-2 max-sm:border-t max-sm:border-border-faint">
            <MetricSkeleton />
          </div>
        </div>
        {[5, 3].map((rows, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <TableSkeleton rows={rows} columns={4} />
          </div>
        ))}
      </div>
    </>
  )
}
