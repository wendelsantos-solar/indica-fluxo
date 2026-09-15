/**
 * Invitations and team membership rules. Pure: no I/O, no framework, so the
 * services, the Settings team panel and the tests read the same rules.
 */

/** Mirrors `workspace_role`; restated so this module stays importable by the client. */
export type WorkspaceRole = "owner" | "admin" | "member"

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export interface InviteLinks {
  /** Sign-up with the address pre-filled and locked: someone without an account. */
  inviteUrl: string
  /** Sign-in with the address pre-filled: someone who already has an account. */
  loginUrl: string
}

/**
 * The links a founder can forward when the e-mail does not arrive. They carry
 * no token and grant nothing: whoever opens one still has to prove they own
 * the address (confirmation e-mail, or the password of an existing account)
 * before `handle_new_user()` hands them the invitation.
 *
 * `signupPath` and `loginPath` are already locale-prefixed and translated
 * (`getPathname`), so this stays free of the routing module.
 */
export function buildInviteLinks(params: {
  appUrl: string
  signupPath: string
  loginPath: string
  email: string
}): InviteLinks {
  const email = params.email.trim().toLowerCase()

  const signup = new URL(params.signupPath, params.appUrl)
  signup.searchParams.set("email", email)
  signup.searchParams.set("invite", "1")

  const login = new URL(params.loginPath, params.appUrl)
  login.searchParams.set("email", email)

  return { inviteUrl: signup.toString(), loginUrl: login.toString() }
}

// ---------------------------------------------------------------------------
// Invite e-mail outcome
// ---------------------------------------------------------------------------

/**
 * Why an invitation e-mail was not sent. None of them undoes the invitation:
 * the row stands and the founder gets a link to forward instead.
 *
 * - `accountExists` — the address already has a confirmed account. Supabase
 *   only sends invitations to new addresses.
 * - `alreadyLinked` — the affiliate record is already tied to an account, so
 *   the new program shows up in their portal without an e-mail.
 * - `notConfigured` — `SUPABASE_SECRET_KEY` is not set on this deployment.
 * - `rateLimited` — the Auth e-mail quota was hit.
 * - `failed` — anything else (network, SMTP, a redirect URL Supabase rejects).
 */
export type InviteMailSkipReason =
  | "accountExists"
  | "alreadyLinked"
  | "notConfigured"
  | "rateLimited"
  | "failed"

const ACCOUNT_EXISTS_CODES = new Set(["email_exists", "user_already_exists"])
const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"])

/**
 * Maps a Supabase Auth Admin error to a reason. Reads the structured `code`
 * first; older GoTrue versions only say it in English, so the message is the
 * fallback ("A user with this email address has already been registered").
 */
export function classifyInviteMailError(error: unknown): Exclude<InviteMailSkipReason, "alreadyLinked" | "notConfigured"> {
  if (!error || typeof error !== "object") return "failed"
  const { code, status, message } = error as { code?: unknown; status?: unknown; message?: unknown }

  if (typeof code === "string" && ACCOUNT_EXISTS_CODES.has(code)) return "accountExists"
  if (typeof code === "string" && RATE_LIMIT_CODES.has(code)) return "rateLimited"
  if (status === 429) return "rateLimited"
  if (typeof message === "string" && /already (been )?registered|already exists/i.test(message)) {
    return "accountExists"
  }
  return "failed"
}

// ---------------------------------------------------------------------------
// Team changes
// ---------------------------------------------------------------------------

export type MemberChange =
  | { kind: "role"; to: Exclude<WorkspaceRole, "owner"> }
  | { kind: "remove" }

/** Catalogue keys under `errors.*`. */
export type MemberChangeRefusal = "memberChangeForbidden" | "ownerProtected" | "lastOwner"

export interface MemberChangeInput {
  actorRole: WorkspaceRole
  targetRole: WorkspaceRole
  /** Owners in the workspace right now, the target included. */
  ownerCount: number
  change: MemberChange
}

/**
 * Whether an owner or admin may change a teammate's role or remove them.
 *
 * - Only owners and admins manage the team.
 * - An admin cannot touch an owner: the lower role cannot unseat the higher.
 * - The last owner can neither be demoted nor removed — a workspace with no
 *   owner has nobody who may delete it. That includes an owner leaving.
 * - Making someone owner is ownership transfer, which is not offered here.
 */
export function checkMemberChange(input: MemberChangeInput): { ok: true } | { ok: false; reason: MemberChangeRefusal } {
  // `change` is not consulted yet: both a role change (which can never be to
  // "owner") and a removal unseat an owner, so they are refused alike.
  const { actorRole, targetRole, ownerCount } = input

  if (actorRole === "member") return { ok: false, reason: "memberChangeForbidden" }
  if (targetRole === "owner" && actorRole !== "owner") return { ok: false, reason: "ownerProtected" }

  if (targetRole === "owner" && ownerCount <= 1) return { ok: false, reason: "lastOwner" }

  return { ok: true }
}
