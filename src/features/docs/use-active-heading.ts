"use client"

import * as React from "react"

/**
 * Which heading the reader is in: the last one whose top has crossed a line
 * a quarter of the way down the viewport. Shared by the sidebar and the
 * "on this page" list so both highlight the same place.
 */
export function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = React.useState<string | null>(null)

  React.useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0) return

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = window.innerHeight * 0.25
        let current: string | null = elements[0]!.id
        for (const element of elements) {
          if (element.getBoundingClientRect().top <= line) current = element.id
          else break
        }
        // At the very bottom the last short sections can never cross the line.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
          current = elements.at(-1)!.id
        }
        setActive(current)
      })
    }

    update()
    // Scroll restoration and anchor jumps can land after the first paint
    // without a scroll event reaching this listener yet.
    const settle = window.setTimeout(update, 150)
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    window.addEventListener("hashchange", update)
    window.addEventListener("load", update)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      window.removeEventListener("hashchange", update)
      window.removeEventListener("load", update)
    }
  }, [ids])

  return active
}
