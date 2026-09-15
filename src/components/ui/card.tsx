import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §6. A bordered panel for a single one-off container — a form, a
 * chart, a composer. Lists and tables do not go in cards: they sit on the
 * content panel between hairlines. No shadow on a resting card.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-panel border border-border bg-surface-1", className)}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  bordered = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { bordered?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3",
        bordered && "border-b border-border",
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-caption font-medium text-foreground", className)} {...props} />
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 text-caption text-muted-foreground", className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border px-4 py-3",
        className,
      )}
      {...props}
    />
  )
}
