import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from "@supabase/supabase-js"

/**
 * What went wrong, in the product's terms rather than Supabase's.
 *
 * Supabase error text is English, changes between versions and sometimes says
 * more than a stranger should learn ("User already registered"). Actions
 * classify the error here and choose their own catalogue key, so provider
 * wording never reaches the page.
 */
export type AuthErrorKind =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "userExists"
  | "weakPassword"
  | "samePassword"
  | "rateLimited"
  | "sessionMissing"
  | "network"
  | "unknown"

const BY_CODE: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  user_already_exists: "userExists",
  email_exists: "userExists",
  weak_password: "weakPassword",
  same_password: "samePassword",
  over_request_rate_limit: "rateLimited",
  over_email_send_rate_limit: "rateLimited",
  session_not_found: "sessionMissing",
  session_expired: "sessionMissing",
  refresh_token_not_found: "sessionMissing",
  reauthentication_needed: "sessionMissing",
  request_timeout: "network",
}

export function classifyAuthError(error: unknown): AuthErrorKind {
  // Checked first: a network failure has no `code`, only a status of 0 or 5xx.
  if (isAuthRetryableFetchError(error)) return "network"
  if (isAuthWeakPasswordError(error)) return "weakPassword"
  if (isAuthSessionMissingError(error)) return "sessionMissing"
  if (!isAuthError(error)) return "unknown"

  const byCode = error.code ? BY_CODE[error.code] : undefined
  if (byCode) return byCode
  if (error.status === 429) return "rateLimited"
  return "unknown"
}
