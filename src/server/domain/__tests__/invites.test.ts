import { describe, expect, it } from "vitest"

import { buildInviteLinks, checkMemberChange, classifyInviteMailError } from "../invites"

describe("buildInviteLinks", () => {
  const base = {
    appUrl: "https://app.indicafluxo.com",
    signupPath: "/pt-br/criar-conta",
    loginPath: "/pt-br/entrar",
  }

  it("builds a localised sign-up link with the address and the invite flag", () => {
    const { inviteUrl } = buildInviteLinks({ ...base, email: "ana@acme.com" })
    expect(inviteUrl).toBe("https://app.indicafluxo.com/pt-br/criar-conta?email=ana%40acme.com&invite=1")
  })

  it("builds a sign-in link with the address and no invite flag", () => {
    const { loginUrl } = buildInviteLinks({ ...base, email: "ana@acme.com" })
    expect(loginUrl).toBe("https://app.indicafluxo.com/pt-br/entrar?email=ana%40acme.com")
  })

  it("normalises the address the way invitations are claimed (trimmed, lower case)", () => {
    const { inviteUrl } = buildInviteLinks({ ...base, email: "  Ana.Souza+Parceira@ACME.com " })
    expect(new URL(inviteUrl).searchParams.get("email")).toBe("ana.souza+parceira@acme.com")
  })

  it("encodes characters that would otherwise break the query", () => {
    const { inviteUrl } = buildInviteLinks({ ...base, email: "a&b=c@acme.com" })
    const url = new URL(inviteUrl)
    expect(url.searchParams.get("email")).toBe("a&b=c@acme.com")
    expect(url.searchParams.get("invite")).toBe("1")
  })

  it("stays on the app origin, whatever the path", () => {
    const { inviteUrl, loginUrl } = buildInviteLinks({
      ...base,
      signupPath: "/en/signup",
      loginPath: "/en/login",
      email: "x@y.z",
    })
    expect(new URL(inviteUrl).origin).toBe("https://app.indicafluxo.com")
    expect(new URL(loginUrl).pathname).toBe("/en/login")
  })
})

describe("classifyInviteMailError", () => {
  it("recognises an existing account by code", () => {
    expect(classifyInviteMailError({ code: "email_exists", status: 422 })).toBe("accountExists")
    expect(classifyInviteMailError({ code: "user_already_exists", status: 422 })).toBe("accountExists")
  })

  it("falls back to the English message of older Auth versions", () => {
    expect(
      classifyInviteMailError({
        status: 422,
        message: "A user with this email address has already been registered",
      }),
    ).toBe("accountExists")
    expect(classifyInviteMailError({ message: "User already registered" })).toBe("accountExists")
  })

  it("recognises the e-mail quota", () => {
    expect(classifyInviteMailError({ code: "over_email_send_rate_limit", status: 429 })).toBe("rateLimited")
    expect(classifyInviteMailError({ status: 429 })).toBe("rateLimited")
  })

  it("treats anything else as a failure", () => {
    expect(classifyInviteMailError({ code: "unexpected_failure", status: 500 })).toBe("failed")
    expect(classifyInviteMailError(new Error("fetch failed"))).toBe("failed")
    expect(classifyInviteMailError(null)).toBe("failed")
    expect(classifyInviteMailError("boom")).toBe("failed")
  })
})

describe("checkMemberChange", () => {
  const demote = { kind: "role", to: "member" } as const
  const remove = { kind: "remove" } as const

  it("never lets a plain member manage the team", () => {
    expect(checkMemberChange({ actorRole: "member", targetRole: "member", ownerCount: 2, change: remove })).toEqual({
      ok: false,
      reason: "memberChangeForbidden",
    })
  })

  it("lets an admin change or remove members and admins", () => {
    expect(checkMemberChange({ actorRole: "admin", targetRole: "member", ownerCount: 1, change: { kind: "role", to: "admin" } }).ok).toBe(true)
    expect(checkMemberChange({ actorRole: "admin", targetRole: "admin", ownerCount: 1, change: demote }).ok).toBe(true)
    expect(checkMemberChange({ actorRole: "admin", targetRole: "admin", ownerCount: 1, change: remove }).ok).toBe(true)
  })

  it("does not let an admin touch an owner, even when there are several", () => {
    expect(checkMemberChange({ actorRole: "admin", targetRole: "owner", ownerCount: 3, change: demote })).toEqual({
      ok: false,
      reason: "ownerProtected",
    })
    expect(checkMemberChange({ actorRole: "admin", targetRole: "owner", ownerCount: 3, change: remove }).ok).toBe(false)
  })

  it("refuses to demote or remove the last owner — including the owner themselves", () => {
    for (const change of [demote, { kind: "role", to: "admin" } as const, remove]) {
      expect(checkMemberChange({ actorRole: "owner", targetRole: "owner", ownerCount: 1, change })).toEqual({
        ok: false,
        reason: "lastOwner",
      })
    }
  })

  it("lets an owner demote or remove another owner while one remains", () => {
    expect(checkMemberChange({ actorRole: "owner", targetRole: "owner", ownerCount: 2, change: demote }).ok).toBe(true)
    expect(checkMemberChange({ actorRole: "owner", targetRole: "owner", ownerCount: 2, change: remove }).ok).toBe(true)
  })
})
