import { describe, expect, it } from "vitest"

import { activationSignals, getActivation } from "../activation"

const none = { hasProgram: false, stripeConnected: false, hasAffiliate: false, hasClick: false }

describe("getActivation", () => {
  it("counts the workspace as done and points at the program first", () => {
    const activation = getActivation(none)
    expect(activation.doneCount).toBe(1)
    expect(activation.total).toBe(5)
    expect(activation.next).toBe("program")
  })

  it("orders stripe, then the first affiliate, then tracking", () => {
    expect(getActivation({ ...none, hasProgram: true }).next).toBe("stripe")
    expect(getActivation({ ...none, hasProgram: true, stripeConnected: true }).next).toBe(
      "affiliate",
    )
    expect(
      getActivation({ ...none, hasProgram: true, stripeConnected: true, hasAffiliate: true }).next,
    ).toBe("tracking")
  })

  it("picks the first pending step even when a later one is already done", () => {
    const activation = getActivation({ ...none, hasProgram: true, hasAffiliate: true, hasClick: true })
    expect(activation.next).toBe("stripe")
    expect(activation.doneCount).toBe(4)
  })

  it("has no next step when everything is done", () => {
    const activation = getActivation({
      hasProgram: true,
      stripeConnected: true,
      hasAffiliate: true,
      hasClick: true,
    })
    expect(activation.next).toBeNull()
    expect(activation.doneCount).toBe(activation.total)
  })
})

describe("activationSignals", () => {
  it("reads only a connected Stripe integration as connected", () => {
    const base = { programs: [], affiliateTotal: 0 }
    expect(
      activationSignals({ ...base, integrations: [{ provider: "stripe", status: "disconnected" }] })
        .stripeConnected,
    ).toBe(false)
    expect(
      activationSignals({ ...base, integrations: [{ provider: "stripe", status: "connected" }] })
        .stripeConnected,
    ).toBe(true)
  })

  it("treats any program with an all-time click as tracking installed", () => {
    const signals = activationSignals({
      programs: [{ clickCount: 0 }, { clickCount: "3" }],
      integrations: [],
      affiliateTotal: 1,
    })
    expect(signals).toEqual({
      hasProgram: true,
      stripeConnected: false,
      hasAffiliate: true,
      hasClick: true,
    })
  })
})
