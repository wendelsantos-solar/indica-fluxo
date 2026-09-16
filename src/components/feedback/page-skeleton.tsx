import { PageHeaderBar } from "@/components/layout/page-header"
import { MetricSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton"

/**
 * Route-level loading states, shaped like the pages they stand in for so the
 * content does not jump when it arrives. Used by `loading.tsx` files; the
 * sticky header bar is drawn too, so the frame never flickers.
 *
 * Every variant draws the header's one-line description by default, because
 * `PageHeader` renders one on almost every page — leaving it out made the
 * content jump by a line (~40px) when the page arrived. Pass
 * `description={false}` for a page without one.
 *
 * - `ListPageSkeleton` — header, filter row, table (optionally a metric strip).
 * - `DetailPageSkeleton` — a record page at the detail width: title block,
 *   metric strip, a section.
 * - `FormPageSkeleton` — a form card of `FormSection` rows (label column on the
 *   left, fields on the right from `md`), then the footer actions.
 */
function HeaderBar({ description = true }: { description?: boolean }) {
  return (
    <>
      <PageHeaderBar hasDescription={description}>
        <Skeleton className="h-3.5 w-32" />
      </PageHeaderBar>
      {description ? (
        // Same box as the description paragraph: one caption line, then 24px.
        <div className="mb-6 flex h-5 items-center">
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      ) : null}
    </>
  )
}

export function ListPageSkeleton({
  metrics = false,
  filters = true,
  description = true,
}: {
  metrics?: boolean
  filters?: boolean
  description?: boolean
}) {
  return (
    <>
      <HeaderBar description={description} />
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
        {filters ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-full sm:w-64" />
            <Skeleton className="h-8 w-40" />
          </div>
        ) : null}
        <TableSkeleton rows={8} columns={5} />
      </div>
    </>
  )
}

export function DetailPageSkeleton({
  description = false,
  metrics = 3,
}: {
  /** Detail pages usually lead with a title block instead of a description. */
  description?: boolean
  metrics?: 3 | 4
}) {
  return (
    <>
      <HeaderBar description={description} />
      {/* The shell centres direct children at the content width; the inner
          wrapper narrows to the detail width, left-aligned like the page. */}
      <div aria-busy="true">
        <div className="max-w-detail space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div
            className={
              "grid grid-cols-2 gap-x-6 border-y border-border " +
              (metrics === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3")
            }
          >
            {Array.from({ length: metrics }).map((_, index) => (
              <MetricSkeleton key={index} />
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <TableSkeleton rows={4} columns={4} />
          </div>
        </div>
      </div>
    </>
  )
}

export function FormPageSkeleton({
  sections = 3,
  description = true,
}: {
  sections?: number
  description?: boolean
}) {
  return (
    <>
      <HeaderBar description={description} />
      <div aria-busy="true">
        <div className="max-w-detail space-y-6">
          <div className="rounded-panel border border-border">
            {Array.from({ length: sections }).map((_, index) => (
              <div
                key={index}
                className="grid gap-4 border-b border-border px-4 py-5 last:border-0 sm:px-5 md:grid-cols-[minmax(0,14rem)_1fr] md:gap-8"
              >
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>
    </>
  )
}
