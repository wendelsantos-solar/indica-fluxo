import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/**
 * The dashboard overview's shape: the four-metric strip (headline figure on its
 * own row on phones, 2×2 from `sm`, one row from `lg` — as `MetricGrid` lays it
 * out), chart + funnel, two tables.
 */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="space-y-10">
      <div className="grid grid-cols-2 gap-x-6 border-y border-border lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={index === 0 ? "col-span-2 sm:col-span-1" : undefined}>
            <MetricSkeleton />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-panel lg:col-span-2" />
        <Skeleton className="h-80 rounded-panel" />
      </div>
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-36" />
          <TableSkeleton rows={5} columns={3} />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-36" />
          <TableSkeleton rows={5} columns={4} />
        </div>
      </div>
    </div>
  )
}
