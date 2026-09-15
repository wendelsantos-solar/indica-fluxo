import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/**
 * A program's detail shape, top to bottom as the page renders it: breadcrumb
 * bar, status line, four performance metrics, the configuration row, the tab
 * strip and the first tab's table — so nothing jumps when the page arrives.
 */
export default function ProgramDetailLoading() {
  return (
    <>
      <div
        data-page-header
        className="sticky top-12 z-sticky -mx-4 mb-6 flex min-h-12 items-center gap-3 border-b border-border bg-surface-1 px-4 md:top-0 md:-mx-6 md:px-6"
      >
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="ml-auto h-7 w-32 rounded-control" />
      </div>

      <div aria-busy="true">
        <div className="max-w-detail space-y-10">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3.5 w-64" />
            </div>

            <div className="grid grid-cols-2 gap-x-6 border-y border-border md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <MetricSkeleton key={index} />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex h-9 items-center gap-5 border-b border-border">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <TableSkeleton rows={6} columns={5} />
          </div>
        </div>
      </div>
    </>
  )
}
