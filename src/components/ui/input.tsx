import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9. A quiet fill and a hairline; focus brightens the border
 * rather than adding a glow. Phones get 16px text so iOS does not zoom.
 */
const control = [
  "w-full rounded-control border border-border bg-fill-subtle text-caption text-foreground",
  "placeholder:text-faint-foreground",
  "transition-colors duration-[120ms]",
  "hover:border-border-strong",
  "focus-visible:border-foreground-secondary focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-danger/70 aria-invalid:focus-visible:border-danger",
  "max-sm:text-body touch:text-body",
].join(" ")

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(control, "h-8 px-2.5 max-sm:h-10 touch:h-10", className)}
      {...props}
    />
  )
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(control, "min-h-20 resize-y px-2.5 py-2", className)}
      {...props}
    />
  )
}

/** Native select styled to match. A listbox is overkill for short option sets. */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        "h-8 appearance-none px-2.5 pr-8 max-sm:h-10 touch:h-10",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%238a8f98%22 stroke-width=%221.5%22><path d=%22M3 4.5 6 7.5 9 4.5%22/></svg>')]",
        "bg-[length:12px_12px] bg-[right_10px_center] bg-no-repeat",
        className,
      )}
      {...props}
    />
  )
}
