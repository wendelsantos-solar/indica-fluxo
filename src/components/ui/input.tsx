import * as React from "react"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-8 w-full rounded-[6px] border border-border bg-surface-2 px-2.5 text-[13px]",
        "text-foreground placeholder:text-muted-foreground",
        "transition-colors duration-[120ms]",
        "focus:border-border-strong focus:outline-2 focus:outline-offset-[-1px] focus:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-danger focus:border-danger",
        className,
      )}
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
      className={cn(
        "w-full rounded-[6px] border border-border bg-surface-2 px-2.5 py-2 text-[13px]",
        "text-foreground placeholder:text-muted-foreground resize-y min-h-20",
        "transition-colors duration-[120ms]",
        "focus:border-border-strong focus:outline-2 focus:outline-offset-[-1px] focus:outline-ring",
        invalid && "border-danger",
        className,
      )}
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
        "h-8 w-full appearance-none rounded-[6px] border border-border bg-surface-2 px-2.5 pr-8",
        "text-[13px] text-foreground transition-colors duration-[120ms]",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%238a8f98%22 stroke-width=%221.5%22><path d=%22M3 4.5 6 7.5 9 4.5%22/></svg>')]",
        "bg-[length:12px_12px] bg-[right_10px_center] bg-no-repeat",
        "focus:border-border-strong focus:outline-2 focus:outline-offset-[-1px] focus:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
