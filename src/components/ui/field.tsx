import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Every form control gets a real <label>, an id, and space reserved for an
 * error message. DESIGN.md §12: never colour alone, always text.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-meta font-medium text-muted-foreground"
      >
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-meta text-faint-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
