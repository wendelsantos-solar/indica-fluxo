"use client"

import { AlertCircle, type LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The small vocabulary every auth screen is built from: a heading, an inline
 * alert, a neutral notice and an icon tile. Kept here rather than in
 * `components/ui` because nothing outside auth needs them yet.
 */

export function AuthHeading({
  title,
  description,
  hint,
  icon: Icon,
  focusOnMount = false,
}: {
  title: string
  description?: React.ReactNode
  /** A quieter second line under the description. */
  hint?: React.ReactNode
  icon?: LucideIcon
  /**
   * For a state that replaces a form in place (check your e-mail, password
   * updated): moving focus to the new heading is what tells a screen reader
   * the screen changed, and keeps keyboard focus off a node that no longer
   * exists.
   */
  focusOnMount?: boolean
}) {
  const ref = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])

  return (
    <div className="mb-8 space-y-2">
      {Icon ? (
        <div className="mb-6 flex size-10 items-center justify-center rounded-control border border-border bg-fill-subtle text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <h1
        ref={ref}
        tabIndex={focusOnMount ? -1 : undefined}
        className="text-balance text-subheading text-foreground focus-visible:outline-none"
      >
        {title}
      </h1>
      {description ? (
        <p className="text-pretty text-ui text-muted-foreground">{description}</p>
      ) : null}
      {hint ? <p className="text-pretty text-caption text-faint-foreground">{hint}</p> : null}
    </div>
  )
}

/** A failure the person can act on. Announced as soon as it appears. */
export function FormAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2 rounded-control bg-danger-subtle px-3 py-2 text-meta text-danger-foreground",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">{children}</p>
    </div>
  )
}

/** Neutral information that arrived with the page, e.g. an expired link. */
export function FormNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex gap-2 rounded-control border border-border bg-fill-subtle px-3 py-2 text-meta text-foreground-secondary",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0">{children}</p>
    </div>
  )
}

/** Inline link style for auth copy: quiet, brightens on hover, never amber. */
export const AUTH_LINK =
  "rounded-hairline font-medium text-foreground-secondary underline-offset-4 transition-colors duration-[120ms] hover:text-foreground hover:underline"

/** A link inside an alert inherits the alert's colour and is marked by underline. */
export const ALERT_LINK =
  "rounded-hairline font-medium underline underline-offset-4 transition-colors duration-[120ms] hover:text-foreground"

/**
 * Submits through the action without letting React reset the form.
 *
 * A `<form action>` resets its uncontrolled fields when the action settles,
 * which would wipe the e-mail someone just typed every time the server says
 * "try again". Intercepting submit and dispatching inside a transition keeps
 * the values and still drives `useActionState`'s pending flag; the `action`
 * attribute stays on the form so it also works before hydration.
 */
export function useSubmit(dispatch: (payload: FormData) => void, pending: boolean) {
  const [, startTransition] = React.useTransition()

  return React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (pending) return
      const data = new FormData(event.currentTarget)
      startTransition(() => dispatch(data))
    },
    [dispatch, pending],
  )
}

/** `aria-describedby` for a field that may carry an error from `Field`. */
export function errorId(field: string, error: unknown): string | undefined {
  return error ? `${field}-error` : undefined
}
