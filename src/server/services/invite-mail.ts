import "server-only"

import { getPathname } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { clientEnv } from "@/lib/env/client"
import { env } from "@/lib/env/server"
import { logger } from "@/lib/logger"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildInviteLinks,
  classifyInviteMailError,
  type InviteLinks,
  type InviteMailSkipReason,
} from "@/server/domain/invites"

/** Who the invitation is for; decides where the accepted invite lands. */
export type InviteAudience = "affiliate" | "member"

export interface InviteDelivery extends InviteLinks {
  emailSent: boolean
  /** Set when `emailSent` is false. */
  skipped?: InviteMailSkipReason
}

const log = logger.child({ module: "invite-mail" })

/** The forwardable links for an address, in the inviter's language. */
export function inviteLinksFor(email: string, locale: Locale): InviteLinks {
  return buildInviteLinks({
    appUrl: clientEnv().NEXT_PUBLIC_APP_URL,
    signupPath: getPathname({ href: "/signup", locale }),
    loginPath: getPathname({ href: "/login", locale }),
    email,
  })
}

/**
 * Where the e-mailed link lands: the auth callback verifies it, then the
 * invitee chooses a password (`/reset-password` works with any session) and
 * continues to the portal or the workspace. Built from `NEXT_PUBLIC_APP_URL`,
 * never from a request header.
 *
 * The Supabase "Invite user" e-mail template must link to
 * `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite`, and
 * `NEXT_PUBLIC_APP_URL/**` must be an allowed redirect URL. The default
 * `{{ .ConfirmationURL }}` returns the session in the URL fragment, which a
 * server route cannot read (admin-issued invites cannot use PKCE).
 */
function inviteRedirectUrl(locale: Locale, audience: InviteAudience): string {
  const next = `${getPathname({ href: "/reset-password", locale })}?invite=${audience}`
  const url = new URL(`/${locale}/auth/callback`, clientEnv().NEXT_PUBLIC_APP_URL)
  url.searchParams.set("next", next)
  return url.toString()
}

/**
 * Sends a Supabase Auth invitation e-mail. Call it only after the invitation
 * row has been committed: the e-mail is a courtesy on top of the row, and a
 * failure here never undoes it — the result says why nothing was sent and
 * carries the links to forward instead.
 *
 * Side effect to know about: for an address with no account, Supabase creates
 * the (password-less, unconfirmed) Auth user at once, so `handle_new_user()`
 * claims the pending invitation immediately rather than when the e-mail is
 * opened. Nobody can use that account without the e-mailed link or a password
 * reset sent to the same address.
 */
export async function sendInviteEmail(params: {
  email: string
  locale: Locale
  audience: InviteAudience
  workspaceName: string
  /** Becomes the profile name through `handle_new_user()`. */
  fullName?: string | null
}): Promise<InviteDelivery> {
  const links = inviteLinksFor(params.email, params.locale)

  if (!env().SUPABASE_SECRET_KEY) {
    log.warn("invite e-mail skipped: SUPABASE_SECRET_KEY is not configured", { audience: params.audience })
    return { ...links, emailSent: false, skipped: "notConfigured" }
  }

  try {
    // Admin client — bypasses RLS. Justified: sending an Auth invitation is an
    // Auth Admin operation (`auth.admin.inviteUserByEmail`) with no RLS
    // equivalent; no policy lets a session create or e-mail another auth user.
    // Nothing is read or written in `public` through this client, and it runs
    // only after `requireMembership(…, "admin")` in the calling service.
    const { error } = await createAdminClient().auth.admin.inviteUserByEmail(params.email, {
      redirectTo: inviteRedirectUrl(params.locale, params.audience),
      data: {
        ...(params.fullName ? { full_name: params.fullName } : {}),
        invited_to: params.workspaceName,
      },
    })

    if (!error) return { ...links, emailSent: true }

    const skipped = classifyInviteMailError(error)
    // Never the address: the audience, the outcome and Supabase's code/status.
    const detail = error as { code?: unknown; status?: unknown }
    log[skipped === "failed" ? "error" : "info"]("invite e-mail not sent", {
      audience: params.audience,
      skipped,
      code: detail.code,
      status: detail.status,
    })
    return { ...links, emailSent: false, skipped }
  } catch (error) {
    log.error("invite e-mail failed", { audience: params.audience, error })
    return { ...links, emailSent: false, skipped: "failed" }
  }
}
