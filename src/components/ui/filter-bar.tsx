"use client"

import { Loader2 } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { useRouter } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

type ObjectHref = Exclude<Parameters<ReturnType<typeof useRouter>["replace"]>[0], string>

const SEARCH_DEBOUNCE_MS = 350

/**
 * A list's filter row that applies on change — no "Aplicar" button, no full
 * reload. Selects apply at once; text fields after a short pause; Enter applies
 * immediately. Each change replaces the URL's query (dropping `page`, so a
 * narrower filter never lands past its last page) while `preserve` keeps what
 * is not a filter, such as the sort.
 *
 * It is still a plain GET form: without JavaScript, Enter submits it and a
 * `<noscript>` button covers the selects.
 *
 * Children are ordinary named `Input`/`Select` elements with `defaultValue`.
 * `values` mirrors the URL, so "clear filters" (a link) also resets the fields.
 */
export function FilterBar({
  href,
  values,
  preserve,
  submitLabel,
  label,
  className,
  children,
}: {
  /** The list's own pathname and params; the query is rebuilt from the form. */
  href: ObjectHref
  /** The filters currently in the URL, by field name. */
  values: Record<string, string | undefined>
  /** Params that are not fields but must survive a filter change (sort, dir). */
  preserve?: Record<string, string | undefined>
  /** The `<noscript>` submit button's label. */
  submitLabel: string
  /** Accessible name of the search landmark. */
  label: string
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Keep fields in step with the URL (back button, "clear filters"), but never
  // overwrite the field someone is typing in.
  React.useEffect(() => {
    const form = formRef.current
    if (!form) return
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) continue
      if (!element.name || element.type === "hidden" || element === document.activeElement) continue
      element.value = values[element.name] ?? ""
    }
  }, [values])

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const apply = React.useCallback(() => {
    const form = formRef.current
    if (!form) return
    if (timer.current) clearTimeout(timer.current)

    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(preserve ?? {})) {
      if (value) query[key] = value
    }
    for (const [key, raw] of new FormData(form).entries()) {
      const value = typeof raw === "string" ? raw.trim() : ""
      if (value) query[key] = value
      else delete query[key]
    }

    startTransition(() => {
      router.replace({ ...href, query }, { scroll: false })
    })
  }, [href, preserve, router])

  const onChange = (event: React.FormEvent<HTMLFormElement>) => {
    const target = event.target
    if (target instanceof HTMLInputElement && (target.type === "search" || target.type === "text")) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(apply, SEARCH_DEBOUNCE_MS)
      return
    }
    apply()
  }

  return (
    <form
      ref={formRef}
      role="search"
      aria-label={label}
      aria-busy={pending || undefined}
      onChange={onChange}
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      className={cn("mb-3 flex flex-wrap items-center gap-2", className)}
    >
      {Object.entries(preserve ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      {children}
      <noscript>
        <Button type="submit" variant="secondary" size="sm">
          {submitLabel}
        </Button>
      </noscript>
      {/* Reserved space, so the row does not shift while a change loads. */}
      <span aria-hidden="true" className="flex size-3.5 items-center text-faint-foreground">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      </span>
    </form>
  )
}
