"use client"

import * as React from "react"
import { toast } from "sonner"

interface ActionResult {
  success?: string
  error?: string
}

/**
 * Bridges a `useActionState` result to the side effects a mutation form may
 * need: closing the dialog it was submitted from, and — only when the outcome
 * is not already visible on screen — a toast.
 *
 * Results are tracked by object identity, not by message text: every action
 * run returns a fresh object, so creating two links in a row fires twice even
 * though both say "Link criado." (DESIGN.md §9: prefer inline feedback; pass
 * `toastOnError: false` when the form renders its own error.)
 *
 * The dialog is closed with a render-phase state update rather than inside an
 * effect, which avoids the cascading re-render `setState` in an effect causes.
 */
export function useActionResult(
  state: ActionResult,
  {
    onSuccess,
    toastOnSuccess = true,
    toastOnError = true,
  }: { onSuccess?: () => void; toastOnSuccess?: boolean; toastOnError?: boolean } = {},
): void {
  const [seen, setSeen] = React.useState<ActionResult>(state)

  if (state !== seen) {
    setSeen(state)
    if (state.success) onSuccess?.()
  }

  React.useEffect(() => {
    if (state.success && toastOnSuccess) toast.success(state.success)
    if (state.error && toastOnError) toast.error(state.error)
  }, [state, toastOnSuccess, toastOnError])
}
