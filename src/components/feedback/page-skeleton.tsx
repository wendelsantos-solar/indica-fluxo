import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/**
 * Route-level loading states, shaped like the pages they stand in for so the
 * content does not jump when it arrives. Used by `loading.tsx` files; the
 * sticky header bar is drawn too, so the frame never flickers.
 */
function HeaderBar() {
  return (
    <div
      data-page-header
      className="sticky top-12 z-20 -mx-4 mb-6 flex min-h-12 items-center border-b border-border bg-surface-1 px-4 md:top-0 md:-mx-6 md:px-6"
    >
      <Skeleton className="h-3.5 w-32" />
    </div>
  )
}

export function ListPageSkeleton({ metrics = false }: { metrics?: boolean }) {
  return (
    <>
      <HeaderBar />
      <div aria-busy="true" className="space-y-6">
        {metrics ? (
          <div className="grid grid-cols-2 gap-x-6 border-y border-border sm:grid-cols-3">
            <MetricSkeleton />
            <MetricSkeleton />
            <div className="hidden sm:block">
              <MetricSkeleton />
            </div>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
        <TableSkeleton rows={8} columns={5} />
      </div>
    </>
  )
}

export function DetailPageSkeleton() {
  return (
    <>
      <HeaderBar />
      {/* The shell centres direct children at the content width; the inner
          wrapper narrows to the detail width, left-aligned like the page. */}
      <div aria-busy="true">
        <div className="max-w-detail space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3.5 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 border-y border-border sm:grid-cols-3">
          <MetricSkeleton />
          <MetricSkeleton />
          <div className="hidden sm:block">
            <MetricSkeleton />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-panel" />
        </div>
      </div>
    </>
  )
}
