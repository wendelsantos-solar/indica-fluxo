import { describe, expect, it } from "vitest"

import { activationSignals, getActivation, shouldShowActivationChecklist } from "../activation"

const none = {
  hasProgram: false,
  stripeConfigured: false,
  stripeEventReceived: false,
  hasAffiliate: false,
  hasClick: false,
}

const all = {
  hasProgram: true,
  stripeConfigured: true,
  stripeEventReceived: true,
  hasAffiliate: true,
  hasClick: true,
}

describe("getActivation", () => {
  it("counts the workspace as done and points at the program first", () => {
    const activation = getActivation(none)
    expect(activation.doneCount).toBe(1)
    expect(activation.total).toBe(5)
    expect(activation.next).toBe("program")
  })

  it("orders stripe, then the first affiliate, then tracking", () => {
    expect(getActivation({ ...none, hasProgram: true }).next).toBe("stripe")
    expect(getActivation({ ...none, hasProgram: true, stripeEventReceived: true }).next).toBe(
      "affiliate",
    )
    expect(
      getActivation({ ...none, hasProgram: true, stripeEventReceived: true, hasAffiliate: true })
        .next,
    ).toBe("tracking")
  })

  it("does not tick Stripe for saved credentials alone — it waits for an event", () => {
    const activation = getActivation({ ...none, hasProgram: true, stripeConfigured: true })
    const stripe = activation.steps.find((step) => step.key === "stripe")
    expect(stripe).toEqual({ key: "stripe", done: false, waiting: true })
    expect(activation.next).toBe("stripe")

    const received = getActivation({ ...none, stripeConfigured: true, stripeEventReceived: true })
    expect(received.steps.find((step) => step.key === "stripe")).toEqual({
      key: "stripe",
      done: true,
      waiting: false,
    })
  })

  it("picks the first pending step even when a later one is already done", () => {
    const activation = getActivation({ ...none, hasProgram: true, hasAffiliate: true, hasClick: true })
    expect(activation.next).toBe("stripe")
    expect(activation.doneCount).toBe(4)
  })

  it("has no next step when everything is done", () => {
    const activation = getActivation(all)
    expect(activation.next).toBeNull()
    expect(activation.doneCount).toBe(activation.total)
  })
})

describe("activationSignals", () => {
  const quiet = { stripe: { configured: false, lastEventAt: null }, tracking: { lastClickAt: null } }

  it("reads Stripe as proven only once an event arrived", () => {
    const base = { programs: [], affiliateTotal: 0 }
    const saved = activationSignals({ ...base, health: { ...quiet, stripe: { configured: true, lastEventAt: null } } })
    expect(saved.stripeConfigured).toBe(true)
    expect(saved.stripeEventReceived).toBe(false)

    const live = activationSignals({
      ...base,
      health: { ...quiet, stripe: { configured: true, lastEventAt: new Date("2026-09-01T00:00:00Z") } },
    })
    expect(live.stripeEventReceived).toBe(true)
  })

  it("treats any all-time click as tracking installed", () => {
    expect(
      activationSignals({
        programs: [{ clickCount: 0 }, { clickCount: "3" }],
        health: quiet,
        affiliateTotal: 1,
      }),
    ).toEqual({
      hasProgram: true,
      stripeConfigured: false,
      stripeEventReceived: false,
      hasAffiliate: true,
      hasClick: true,
    })

    expect(
      activationSignals({
        programs: [{ clickCount: 0 }],
        health: { ...quiet, tracking: { lastClickAt: new Date("2026-09-01T00:00:00Z") } },
        affiliateTotal: 0,
      }).hasClick,
    ).toBe(true)
  })
})

describe("shouldShowActivationChecklist", () => {
  const idle = { hasCommission: false, hasOutstandingMoney: false }

  it("shows the checklist for a new workspace", () => {
    expect(shouldShowActivationChecklist({ activation: getActivation(none), ...idle })).toBe(true)
    expect(
      shouldShowActivationChecklist({
        activation: getActivation({ ...all, hasClick: false }),
        ...idle,
      }),
    ).toBe(true)
  })

  it("shows the dashboard once activation is complete, even with a quiet month", () => {
    expect(shouldShowActivationChecklist({ activation: getActivation(all), ...idle })).toBe(false)
  })

  it("shows the dashboard once a click proves the program is live", () => {
    expect(
      shouldShowActivationChecklist({
        activation: getActivation({ ...none, hasProgram: true, hasAffiliate: true, hasClick: true }),
        ...idle,
      }),
    ).toBe(false)
  })

  it("never hides money that is owed or recorded", () => {
    const incomplete = getActivation({ ...none, hasProgram: true })
    expect(
      shouldShowActivationChecklist({ activation: incomplete, hasCommission: false, hasOutstandingMoney: true }),
    ).toBe(false)
    expect(
      shouldShowActivationChecklist({ activation: incomplete, hasCommission: true, hasOutstandingMoney: false }),
    ).toBe(false)
  })
})
