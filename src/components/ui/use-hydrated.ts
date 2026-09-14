"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/**
 * `false` during SSR and the first client render, `true` afterwards.
 *
 * Used where the correct output depends on browser-only state (the resolved
 * theme). `useSyncExternalStore` gives the server and client snapshots
 * directly, so no effect and no post-hydration `setState` is needed.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
