"use client"

import { Check, MailCheck } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Button } from "@/components/ui/button"

import { resendConfirmation, type ResendState } from "./actions"
import { AuthHeading, FormAlert } from "./auth-ui"

/** Supabase's default per-address send limit is one e-mail a minute. */
const COOLDOWN_SECONDS = 60

/**
 * Shown in place of the sign-up form when the account waits for e-mail
 * confirmation. Repeating the address back is deliberate: it is what lets
 * someone spot a typo and start again.
 *
 * No amber here: the real next step happens in the inbox, so resending is a
 * fallback, not the action the screen exists for.
 */
export function CheckEmail({ email, onUseAnother }: { email: string; onUseAnother: () => void }) {
  const t = useTranslations("auth.checkEmail")
  const tSuccess = useTranslations("success")
  const [result, setResult] = React.useState<ResendState>({ status: "idle" })
  const [remaining, setRemaining] = React.useState(0)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [remaining])

  function resend() {
    if (pending || remaining > 0) return
    startTransition(async () => {
      const next = await resendConfirmation(email)
      startTransition(() => {
        setResult(next)
        if (next.status === "sent") setRemaining(COOLDOWN_SECONDS)
      })
    })
  }

  return (
    <>
      <AuthHeading
        icon={MailCheck}
        title={t("title")}
        focusOnMount
        hint={t("hint")}
        description={t.rich("body", {
          strong: (chunks) => (
            <span className="break-words font-medium text-foreground">{chunks}</span>
          ),
          email,
        })}
      />

      {result.status === "error" && result.error ? (
        <FormAlert className="mb-4">{result.error}</FormAlert>
      ) : null}

      <div className="space-y-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full max-sm:h-10"
          loading={pending}
          disabled={remaining > 0}
          onClick={resend}
        >
          {remaining > 0 ? t("resendIn", { seconds: remaining }) : t("resend")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full max-sm:h-10"
          onClick={onUseAnother}
        >
          {t("useAnother")}
        </Button>
      </div>

      {/* Always mounted, so "sent" is announced when it appears. */}
      <div role="status" className="mt-4 min-h-5">
        {result.status === "sent" ? (
          <p className="flex items-center gap-1.5 text-meta text-success-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            {tSuccess("confirmationResent")}
          </p>
        ) : null}
      </div>
    </>
  )
}
