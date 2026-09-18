import { describe, expect, it } from "vitest"

import { deriveSetup } from "../setup"

describe("deriveSetup", () => {
  const nothing = { trackerDetected: false, identityDetected: false, selection: null, connections: [] }

  it("starts with every step pending and waits for the tracker on its own", () => {
    const setup = deriveSetup(nothing)
    expect(setup.ready).toBe(false)
    expect(setup.waiting).toBe(true)
    expect(setup.steps.map((step) => step.key)).toEqual(["tracker", "identity", "choose", "connect", "test"])
  })

  it("lists each chosen provider, and is ready with one working provider", () => {
    const setup = deriveSetup({
      trackerDetected: true,
      identityDetected: true,
      selection: ["stripe", "mercado_pago"],
      connections: [{ provider: "stripe", overall: "healthy", events: 3, payments: 1 }],
    })
    const connect = setup.steps.filter((step) => step.key === "connect")
    expect(connect.map((step) => [step.provider, step.done, step.optional])).toEqual([
      ["stripe", true, true],
      ["mercado_pago", false, true],
    ])
    expect(setup.ready).toBe(true)
    expect(setup.waiting).toBe(false)
    expect(setup.done).toBe(setup.total - 1)
  })

  it("is not ready while the only provider has not delivered an event", () => {
    const setup = deriveSetup({
      trackerDetected: true,
      identityDetected: true,
      selection: ["asaas"],
      connections: [{ provider: "asaas", overall: "connecting", events: 0, payments: 0 }],
    })
    expect(setup.ready).toBe(false)
    expect(setup.waiting).toBe(true)
    expect(setup.steps.find((step) => step.key === "connect")?.optional).toBe(false)
  })

  it("never ticks a provider whose connection is refused or still waiting — it says which", () => {
    const setup = deriveSetup({
      trackerDetected: true,
      identityDetected: true,
      selection: ["stripe", "abacatepay"],
      connections: [
        { provider: "stripe", overall: "connecting", events: 0, payments: 0 },
        { provider: "abacatepay", overall: "actionRequired", events: 0, payments: 0 },
      ],
    })
    const connect = setup.steps.filter((step) => step.key === "connect")
    expect(connect.map((step) => [step.provider, step.done, step.state])).toEqual([
      ["stripe", false, "waiting"],
      ["abacatepay", false, "attention"],
    ])
    expect(setup.ready).toBe(false)
  })
})

describe("deriveSetup — a setup left halfway", () => {
  it("keeps the provider's step open as incomplete, with the connection to resume", () => {
    const setup = deriveSetup({
      trackerDetected: true,
      identityDetected: true,
      selection: null,
      connections: [{ provider: "stripe", overall: "notConnected", events: 0, payments: 0, incomplete: true, id: "conn_1" }],
    })
    const connect = setup.steps.find((step) => step.key === "connect")
    expect(connect).toMatchObject({ provider: "stripe", done: false, state: "incomplete", connectionId: "conn_1" })
    expect(setup.ready).toBe(false)
    // Nothing arrives on its own: no auto-refresh for an unfinished manual step.
    expect(setup.waiting).toBe(false)
  })
})
