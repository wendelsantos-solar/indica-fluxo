"use client"

import { useTranslations } from "next-intl"

import { ReferralLinkField } from "@/components/data-display/copy-button"
import { InlineAlert } from "@/components/feedback/inline-alert"
import type { InviteMailSkipReason } from "@/server/domain/invites"

export interface InviteOutcomeProps {
  email: string
  emailSent: boolean
  skipped?: InviteMailSkipReason
  inviteUrl: string
  loginUrl: string
  /** The affiliate's name, for the "already has portal access" wording. */
  name?: string
  className?: string
}

/**
 * What happened to an invitation, told plainly: whether an e-mail actually
 * left, and a link the founder can forward either way. Shared by the affiliate
 * invite dialog and the Settings team panel.
 *
 * The link is the sign-up page with the address filled in; for someone who
 * already has an account it is the sign-in page — signing in claims pending
 * invitations for that address (`claim_pending_invites`, migration 0008).
 */
export function InviteOutcome({
  email,
  emailSent,
  skipped,
  inviteUrl,
  loginUrl,
  name,
  className,
}: InviteOutcomeProps) {
  const t = useTranslations("forms.inviteOutcome")

  const signIn = skipped === "alreadyLinked" || skipped === "accountExists"
  const link = signIn ? loginUrl : inviteUrl

  const message = emailSent
    ? t("sent", { email })
    : skipped === "alreadyLinked"
      ? t("alreadyLinked", { name: name ?? email })
      : skipped === "accountExists"
        ? t("accountExists", { email })
        : skipped === "notConfigured"
          ? t("notConfigured")
          : skipped === "rateLimited"
            ? t("rateLimited")
            : t("failed")

  return (
    <div className={className}>
      <InlineAlert tone={emailSent || skipped === "alreadyLinked" ? "success" : "info"}>{message}</InlineAlert>

      {link ? (
        <div className="mt-4 space-y-2">
          <p className="text-meta text-muted-foreground">
            {signIn ? t("loginLinkLabel") : t("linkLabel")}
          </p>
          <ReferralLinkField url={link} copyLabel={t("copyLink")} />
          <p className="text-meta text-faint-foreground">
            {emailSent ? t("hintSent") : signIn ? t("hintLogin") : t("hintNotSent", { email })}
          </p>
        </div>
      ) : null}
    </div>
  )
}
