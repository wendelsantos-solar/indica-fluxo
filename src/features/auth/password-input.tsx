"use client"

import { Check, Circle, Eye, EyeOff } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Input, type InputProps } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export const PASSWORD_MIN_LENGTH = 8

/**
 * A password field with the three affordances people expect: reveal what was
 * typed, a warning when Caps Lock is on, and — when creating a password — the
 * one rule we enforce, ticked off live.
 *
 * The rule row is neutral until it is met; it is never an error before the
 * person has typed, and it only announces when its state flips.
 */
export function PasswordInput({
  id,
  showRequirement = false,
  className,
  onChange,
  onKeyDown,
  onKeyUp,
  onBlur,
  "aria-describedby": describedBy,
  ...props
}: Omit<InputProps, "type"> & { id: string; showRequirement?: boolean }) {
  const t = useTranslations("auth.password")
  const [visible, setVisible] = React.useState(false)
  const [capsLock, setCapsLock] = React.useState(false)
  const [length, setLength] = React.useState(0)

  const met = length >= PASSWORD_MIN_LENGTH
  const capsId = `${id}-caps`
  const requirementId = `${id}-requirement`

  function readCapsLock(event: React.KeyboardEvent<HTMLInputElement>) {
    // `getModifierState` is undefined for synthetic key events some password
    // managers dispatch; treat those as "unknown", not "on".
    if (typeof event.getModifierState === "function") {
      setCapsLock(event.getModifierState("CapsLock"))
    }
  }

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn("pr-10", className)}
          aria-describedby={
            [describedBy, showRequirement ? requirementId : null, capsLock ? capsId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onChange={(event) => {
            setLength(event.currentTarget.value.length)
            onChange?.(event)
          }}
          onKeyDown={(event) => {
            readCapsLock(event)
            onKeyDown?.(event)
          }}
          onKeyUp={(event) => {
            readCapsLock(event)
            onKeyUp?.(event)
          }}
          onBlur={(event) => {
            setCapsLock(false)
            onBlur?.(event)
          }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t("hide") : t("show")}
          aria-pressed={visible}
          aria-controls={id}
          className={cn(
            "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-control text-faint-foreground",
            "transition-colors duration-[120ms] hover:text-foreground",
            "max-sm:w-10 touch:w-10",
          )}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Always mounted, and never display:none, so the live region exists
          before its text appears and screen readers announce the change. */}
      <div id={capsId} aria-live="polite">
        {capsLock ? (
          <p className="mt-1.5 text-meta text-warning-foreground">{t("capsLock")}</p>
        ) : null}
      </div>

      {showRequirement ? (
        <p
          id={requirementId}
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-meta transition-colors duration-[120ms]",
            met ? "text-foreground-secondary" : "text-faint-foreground",
          )}
        >
          {met ? (
            <Check className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <Circle className="size-3.5" aria-hidden="true" />
          )}
          <span>{t("requirementLength", { count: PASSWORD_MIN_LENGTH })}</span>
          <span className="sr-only">{met ? t("requirementMet") : t("requirementUnmet")}</span>
        </p>
      ) : null}
    </div>
  )
}
