"use client"

import { useEffect } from "react"

import { useRouter } from "@/i18n/navigation"

/**
 * Re-reads the page's server data while something is being waited for — the
 * tracker's first click, the first identify, a connection's first event — so
 * the founder never has to click "I installed it" (brief §22).
 *
 * Kept gentle on purpose (brief §52): one `router.refresh()` every
 * `intervalMs` only while the tab is visible — a hidden tab, a second tab in
 * the background or a locked phone sends nothing; coming back refreshes once
 * at once; and after `maxMs` of waiting it stops for good (a forgotten tab does
 * not poll all night). It stops as soon as `active` turns false and cleans up
 * on unmount.
 */
export function AutoRefresh({
  active,
  intervalMs = 10_000,
  maxMs = 15 * 60_000,
}: {
  active: boolean
  intervalMs?: number
  maxMs?: number
}) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    let timer: number | undefined

    const expired = () => Date.now() - startedAt > maxMs
    const stop = () => {
      window.clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      if (timer !== undefined || expired()) return
      timer = window.setInterval(() => {
        if (expired()) return stop()
        router.refresh()
      }, intervalMs)
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (expired()) return
        router.refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [active, intervalMs, maxMs, router])
  return null
}
