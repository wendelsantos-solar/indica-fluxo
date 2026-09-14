import * as React from "react"

import { cn } from "@/lib/utils"

/** DESIGN.md §6: surface contrast + hairline. No shadow on a resting card. */
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
        "flex items-start justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4",
        bordered && "border-b border-border",
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-body-sm font-medium tracking-tight", className)} {...props} />
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-caption text-muted-foreground", className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6",
        className,
      )}
      {...props}
    />
  )
}
