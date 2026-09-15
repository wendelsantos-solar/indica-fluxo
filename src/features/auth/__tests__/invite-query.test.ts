import { describe, expect, it } from "vitest"

import { parseInviteQuery } from "../invite-query"

describe("parseInviteQuery", () => {
  it("reads an invitation sign-up link", () => {
    expect(parseInviteQuery({ email: "ana@acme.com", invite: "1" })).toEqual({
      email: "ana@acme.com",
      invited: true,
      audience: undefined,
    })
  })

  it("normalises the address", () => {
    expect(parseInviteQuery({ email: " Ana@ACME.com " }).email).toBe("ana@acme.com")
  })

  it("drops anything that is not an e-mail address", () => {
    expect(parseInviteQuery({ email: "<script>alert(1)</script>", invite: "1" }).email).toBeUndefined()
    expect(parseInviteQuery({ email: "" }).email).toBeUndefined()
    expect(parseInviteQuery({}).email).toBeUndefined()
  })

  it("takes the first value of a repeated parameter", () => {
    expect(parseInviteQuery({ email: ["a@b.co", "c@d.co"] }).email).toBe("a@b.co")
  })

  it("reads the audience on the password page, and nothing else", () => {
    expect(parseInviteQuery({ invite: "affiliate" }).audience).toBe("affiliate")
    expect(parseInviteQuery({ invite: "member" }).audience).toBe("member")
    expect(parseInviteQuery({ invite: "owner" }).audience).toBeUndefined()
    expect(parseInviteQuery({ invite: "affiliate" }).invited).toBe(false)
  })
})
