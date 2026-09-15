import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { classifyAuthError } from "../auth-errors"

describe("classifyAuthError", () => {
  it.each([
    ["invalid_credentials", 400, "invalidCredentials"],
    ["email_not_confirmed", 400, "emailNotConfirmed"],
    ["user_already_exists", 422, "userExists"],
    ["email_exists", 422, "userExists"],
    ["weak_password", 422, "weakPassword"],
    ["same_password", 422, "samePassword"],
    ["over_email_send_rate_limit", 429, "rateLimited"],
    ["over_request_rate_limit", 429, "rateLimited"],
    ["session_not_found", 403, "sessionMissing"],
  ] as const)("maps the %s code", (code, status, kind) => {
    expect(classifyAuthError(new AuthApiError("provider text", status, code))).toBe(kind)
  })

  it("treats an uncoded 429 as a rate limit", () => {
    expect(classifyAuthError(new AuthApiError("slow down", 429, undefined))).toBe("rateLimited")
  })

  it("recognises network failures, weak passwords and missing sessions by class", () => {
    expect(classifyAuthError(new AuthRetryableFetchError("fetch failed", 0))).toBe("network")
    expect(classifyAuthError(new AuthWeakPasswordError("weak", 422, ["length"]))).toBe(
      "weakPassword",
    )
    expect(classifyAuthError(new AuthSessionMissingError())).toBe("sessionMissing")
  })

  it("never guesses about errors it does not know", () => {
    expect(classifyAuthError(new AuthApiError("?", 400, "something_new"))).toBe("unknown")
    expect(classifyAuthError(new Error("boom"))).toBe("unknown")
    expect(classifyAuthError(undefined)).toBe("unknown")
  })
})
