"use client"

import * as React from "react"

import { CopyButton } from "@/components/data-display/copy-button"
import { cn } from "@/lib/utils"

/**
 * A machine value on a quiet well — webhook URL, tracking code, a freshly
 * generated key — with a copy button only when what is shown is what works.
 * One shape for every code-and-copy field on the integrations page.
 */
export function CodeField({
  children,
  copyValue,
  className,
}: {
  children: React.ReactNode
  /** Omit when the displayed value is incomplete and copying it would mislead. */
  copyValue?: string
  className?: string
}) {
  const id = React.useId()

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-control border border-border bg-fill-subtle p-1.5 sm:flex-row sm:items-start",
        className,
      )}
    >
      <code
        id={id}
        className={cn(
          "min-w-0 flex-1 break-all px-1 py-1 font-mono text-meta text-foreground-secondary",
          copyValue && "select-all",
        )}
      >
        {children}
      </code>
      {copyValue ? <CopyButton value={copyValue} describedBy={id} className="max-sm:w-full" /> : null}
    </div>
  )
}
