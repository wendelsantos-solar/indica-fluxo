import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The most important component in the product — DESIGN.md §9.
 * Bordered container, borderless table, sticky header, 48px rows,
 * right-aligned tabular numerals.
 */
export function TableContainer({
  className,
  scrollable = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { scrollable?: boolean }) {
  return (
    <div
      data-slot="scrollable"
      className={cn(
        "overflow-hidden rounded-panel border border-border bg-surface-1",
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
  return <thead className={cn("bg-surface-2", className)} {...props} />
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
        "h-9 px-4 text-left align-middle text-label font-medium uppercase tracking-[0.02em] text-muted-foreground",
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
        "border-b border-border",
        interactive &&
          "cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 focus-within:bg-surface-2",
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
        "h-12 px-4 align-middle text-foreground-secondary",
        numeric && "text-right",
        mono && "font-mono text-meta",
        className,
      )}
      {...props}
    />
  )
}
