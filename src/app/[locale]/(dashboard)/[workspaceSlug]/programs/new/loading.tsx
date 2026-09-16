import { PageHeaderBar } from "@/components/layout/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The new-program form's shape: breadcrumb bar and its description line, then
 * one card of titled field groups at the detail width — not the list skeleton.
 */
export default function NewProgramLoading() {
  return (
    <>
      <PageHeaderBar hasDescription>
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-28" />
      </PageHeaderBar>
      <div className="mb-6">
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>

      <div aria-busy="true">
        <div className="max-w-detail rounded-panel border border-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="grid gap-4 border-t border-border px-4 py-5 first:border-t-0 sm:px-5 md:grid-cols-[minmax(0,14rem)_1fr] md:gap-8"
            >
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-full rounded-control" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-8 w-full rounded-control" />
                  <Skeleton className="h-8 w-full rounded-control" />
                </div>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-3 border-t border-border px-4 py-3 sm:px-5">
            <Skeleton className="h-8 w-20 rounded-control" />
            <Skeleton className="h-8 w-28 rounded-control" />
          </div>
        </div>
      </div>
    </>
  )
}
