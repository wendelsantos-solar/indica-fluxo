import { z } from "zod"

/**
 * Reads the query an invitation link carries — `/signup?email=…&invite=1`,
 * `/login?email=…`, `/reset-password?invite=affiliate|member` — for the auth
 * pages. Anything malformed is dropped rather than shown: these are
 * attacker-editable URLs, and a locked e-mail field must hold a real address.
 */
export interface InviteQuery {
  /** Pre-fills (and on sign-up, locks) the e-mail field. */
  email?: string
  /** `?invite=1` on sign-up. */
  invited: boolean
  /** `?invite=affiliate|member` on the password page after an invitation e-mail. */
  audience?: "affiliate" | "member"
}

const emailSchema = z.string().trim().toLowerCase().email().max(320)

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseInviteQuery(query: Record<string, string | string[] | undefined>): InviteQuery {
  const email = emailSchema.safeParse(first(query.email))
  const invite = first(query.invite)
  return {
    email: email.success ? email.data : undefined,
    invited: invite === "1",
    audience: invite === "affiliate" || invite === "member" ? invite : undefined,
  }
}
