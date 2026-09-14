import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The most important component in the product — DESIGN.md §9.
 *
 * Tables sit directly on the content panel, separated by hairlines rather than
 * boxed in a card: the panel is already the container. Header in plain case,
 * 48px single-purpose rows, right-aligned tabular numerals.
 *
 * `bordered` restores a radius-12 frame for the rare table that shares a row
 * with other content (a card grid) and would otherwise float.
 */
export function TableContainer({
  className,
  scrollable = false,
  bordered = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { scrollable?: boolean; bordered?: boolean }) {
  return (
    <div
      data-slot="scrollable"
      data-bordered={bordered || undefined}
      className={cn(
        "group/table border-y border-border",
        bordered && "overflow-hidden rounded-panel border-x bg-surface-1",
        scrollable && "overflow-x-auto",
        className,
      )}
      {...props}
    />
  )
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full border-collapse text-caption tabular-nums", className)}
      {...props}
    />
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border", className)} {...props} />
}

export function TH({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 whitespace-nowrap px-3 text-left align-middle font-normal text-muted-foreground",
        "first:pl-1 last:pr-1 group-data-bordered/table:first:pl-4 group-data-bordered/table:last:pr-4",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child]:border-0", className)} {...props} />
}

export function TR({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-border-faint",
        interactive &&
          "cursor-pointer transition-colors duration-[120ms] hover:bg-hover focus-within:bg-hover",
        className,
      )}
      {...props}
    />
  )
}

export function TD({
  className,
  numeric,
  mono,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; mono?: boolean }) {
  return (
    <td
      className={cn(
        "h-12 px-3 align-middle text-foreground-secondary first:pl-1 last:pr-1",
        "group-data-bordered/table:first:pl-4 group-data-bordered/table:last:pr-4",
        numeric && "whitespace-nowrap text-right",
        mono && "whitespace-nowrap font-mono text-meta",
        className,
      )}
      {...props}
    />
  )
}
