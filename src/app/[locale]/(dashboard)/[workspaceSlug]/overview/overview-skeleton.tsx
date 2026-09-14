import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/** The has-data overview's shape: metric strip, chart + funnel, two tables. */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="space-y-10">
      <div className="grid grid-cols-2 gap-x-6 border-y border-border lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={index > 1 ? "max-lg:hidden" : undefined}>
            <MetricSkeleton />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-panel lg:col-span-2" />
        <Skeleton className="h-72 rounded-panel" />
      </div>
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        <TableSkeleton rows={5} columns={3} />
        <TableSkeleton rows={5} columns={4} />
      </div>
    </div>
  )
}
