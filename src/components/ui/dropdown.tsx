"use client"

import * as Primitive from "@radix-ui/react-dropdown-menu"
import { Check } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export const Dropdown = Primitive.Root
export const DropdownTrigger = Primitive.Trigger

export function DropdownContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-popover min-w-[200px] overflow-hidden rounded-panel bg-surface-3 p-1 shadow-overlay",
          "data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function DropdownItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex h-8 cursor-pointer select-none items-center gap-2 rounded-control px-2 touch:h-10",
        "text-caption text-foreground-secondary outline-none",
        "data-[highlighted]:bg-selected data-[highlighted]:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function DropdownCheckItem({
  className,
  checked,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { checked?: boolean }) {
  return (
    <DropdownItem className={cn("justify-between", className)} {...props}>
      <span className="flex items-center gap-2">{children}</span>
      {checked ? <Check className="size-3.5 text-foreground" aria-hidden="true" /> : null}
    </DropdownItem>
  )
}

export function DropdownLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn(
        "px-2 pb-1 pt-1.5 text-meta text-faint-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function DropdownSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}
