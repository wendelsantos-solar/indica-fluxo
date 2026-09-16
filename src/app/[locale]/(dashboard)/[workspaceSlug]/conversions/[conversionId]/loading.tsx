import { PageHeaderBar } from "@/components/layout/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * A conversion's path, top to bottom as the page renders it: breadcrumb bar
 * and description, the timeline of ringed steps on the left, the attribution
 * panel on the right — so nothing jumps when the page arrives.
 */
export default function ConversionTrailLoading() {
  return (
    <>
      <PageHeaderBar hasDescription>
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-5 w-16" />
      </PageHeaderBar>
      <div className="mb-6 flex h-5 items-center">
        <Skeleton className="h-3 w-full max-w-md" />
      </div>

      <div aria-busy="true" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <ol className="min-w-0 max-w-detail">
          {Array.from({ length: 5 }).map((_, index) => (
            <li key={index} className="flex gap-3 pb-6 last:pb-0">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2 pt-1">
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3.5 w-32" />
                  {index > 1 ? <Skeleton className="h-3.5 w-20" /> : null}
                </div>
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-full max-w-sm" />
              </div>
            </li>
          ))}
        </ol>

        <div className="min-w-0 lg:border-l lg:border-border lg:pl-6">
          <Skeleton className="mb-4 mt-2 h-3.5 w-24" />
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex min-h-10 items-center justify-between gap-4 border-b border-border-faint py-2.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
