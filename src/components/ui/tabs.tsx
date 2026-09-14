"use client"

import * as Primitive from "@radix-ui/react-tabs"
import * as React from "react"

import { cn } from "@/lib/utils"

export const Tabs = Primitive.Root
export const TabsContent = Primitive.Content

export function TabsList({ className, ...props }: React.ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn("flex items-center gap-1 border-b border-border", className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "relative -mb-px px-3 py-2 text-[13px] font-medium text-muted-foreground",
        "transition-colors duration-[120ms]",
        "hover:text-foreground-secondary",
        "data-[state=active]:text-foreground",
        "after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent",
        "data-[state=active]:after:bg-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  )
}

/** Link-based tabs for route segments, which Radix cannot own. */
export function TabLink({
  active,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { active?: boolean }) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative -mb-px px-3 py-2 text-[13px] font-medium transition-colors duration-[120ms]",
        active
          ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground"
          : "text-muted-foreground hover:text-foreground-secondary",
        className,
      )}
      {...props}
    />
  )
}
