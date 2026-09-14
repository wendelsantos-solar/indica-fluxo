"use client"

import * as React from "react"
import { toast } from "sonner"

interface ActionResult {
  success?: string
  error?: string
}

/**
 * Bridges a `useActionState` result to the two side effects every mutation
 * form needs: a toast, and closing the dialog it was submitted from.
 *
 * The dialog is closed with a render-phase state update rather than inside an
 * effect — React treats that as part of the same render pass, which avoids the
 * cascading re-render that `setState` in an effect causes.
 */
export function useActionResult(
  state: ActionResult,
  { onSuccess, toastOnSuccess = true }: { onSuccess?: () => void; toastOnSuccess?: boolean } = {},
): void {
  const [seenSuccess, setSeenSuccess] = React.useState<string | undefined>(undefined)

  if (state.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success)
    onSuccess?.()
  }

  React.useEffect(() => {
    if (state.success && toastOnSuccess) toast.success(state.success)
  }, [state.success, toastOnSuccess])

  React.useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])
}
