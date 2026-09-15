import { Skeleton } from "@/components/ui/skeleton"

/**
 * Portal loading states. Same geometry as the pages: the sticky header bar, a
 * one-line description, then stacked rows below `md` and a table from `md`.
 */
export function PortalHeaderSkeleton({ description = true }: { description?: boolean }) {
  return (
    <>
      <div
        data-page-header
        className="sticky top-12 z-sticky -mx-4 mb-5 flex min-h-12 items-center border-b border-border bg-surface-1 px-4 md:top-0 md:-mx-6 md:px-6"
      >
        <Skeleton className="h-3.5 w-28" />
      </div>
      {description ? <Skeleton className="mb-6 h-3.5 w-full max-w-sm" /> : null}
    </>
  )
}

export function PortalListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="border-y border-border">
      <div className="hidden h-9 items-center gap-4 border-b border-border px-1 md:flex">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex h-16 flex-col justify-center gap-2 border-b border-border-faint px-1 last:border-0 md:h-12 md:flex-row md:items-center md:gap-4"
        >
          <div className="flex items-center justify-between gap-4 md:contents">
            <Skeleton className="h-3.5 w-36 md:flex-[1.6]" />
            <Skeleton className="h-3.5 w-20 md:flex-1" />
          </div>
          <Skeleton className="h-3 w-48 md:h-3.5 md:flex-1" />
        </div>
      ))}
    </div>
  )
}
