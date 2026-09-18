import { describe, expect, it } from "vitest"

import {
  connectionDisplayState,
  connectionPresence,
  deriveConnectionHealth,
  displayTone,
  summarizeHealth,
  workspaceStatus,
  type ConnectionEvidence,
} from "../health"

const NOW = new Date("2026-09-18T12:00:00Z")
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

const base: ConnectionEvidence = {
  status: "connected",
  statusReason: null,
  credentialsSaved: true,
  configuredAt: hoursAgo(48),
  lastRejectedAt: null,
  lastEventAt: hoursAgo(1),
  lastEventFailed: false,
  events: 10,
  failed: 0,
  unsupported: 0,
  withoutCustomer: 0,
  mismatched: 0,
  payments: 4,
  paymentsWithCommission: 2,
  expectedWithoutCommission: 0,
}

describe("deriveConnectionHealth", () => {
  it("is healthy when events arrive, find customers and attributed ones earn", () => {
    const health = deriveConnectionHealth(base, NOW)
    expect(health.overall).toBe("healthy")
    expect(health.issues).toEqual([])
    expect(health.stages).toMatchObject({ auth: "healthy", webhook: "healthy", commission: "healthy" })
  })

  it("never alerts on organic payments", () => {
    const health = deriveConnectionHealth({ ...base, paymentsWithCommission: 0 }, NOW)
    expect(health.overall).toBe("healthy")
    expect(health.stages.attribution).toBe("healthy")
  })

  it("warns when an attributed customer paid and earned nothing", () => {
    const health = deriveConnectionHealth({ ...base, expectedWithoutCommission: 1 }, NOW)
    expect(health.overall).toBe("degraded")
    expect(health.issues).toContain("expectedAttributionMissing")
  })

  it("asks for action when the signature is rejected after setup", () => {
    const health = deriveConnectionHealth({ ...base, lastEventAt: hoursAgo(30), lastRejectedAt: hoursAgo(2) }, NOW)
    expect(health.overall).toBe("actionRequired")
    expect(health.stages.webhook).toBe("error")
    expect(health.issues[0]).toBe("signatureRejected")
  })

  it("is connecting, not healthy, until the first event arrives", () => {
    const health = deriveConnectionHealth({ ...base, lastEventAt: null, events: 0, payments: 0, paymentsWithCommission: 0 }, NOW)
    expect(health.overall).toBe("connecting")
    expect(health.issues).toEqual(["awaitingFirstEvent"])
  })

  it("reports failed processing as an error and dropped payments as action required", () => {
    expect(deriveConnectionHealth({ ...base, failed: 2, lastEventFailed: true }, NOW).overall).toBe("error")
    expect(deriveConnectionHealth({ ...base, withoutCustomer: 3 }, NOW).overall).toBe("actionRequired")
  })

  it("flags invalid credentials and a quiet connection", () => {
    expect(deriveConnectionHealth({ ...base, status: "error", statusReason: "invalid_credentials" }, NOW).issues).toContain(
      "authFailed",
    )
    const quiet = deriveConnectionHealth({ ...base, lastEventAt: hoursAgo(24 * 10) }, NOW)
    expect(quiet.overall).toBe("degraded")
    expect(quiet.issues).toEqual(["quiet"])
  })

  it("is not connected once disconnected", () => {
    expect(deriveConnectionHealth({ ...base, status: "disconnected", credentialsSaved: false }, NOW).overall).toBe(
      "notConnected",
    )
  })
})

describe("summarizeHealth", () => {
  it("counts connected, healthy and needing attention", () => {
    expect(summarizeHealth(["healthy", "healthy", "actionRequired", "connecting", "notConnected"])).toEqual({
      connected: 4,
      healthy: 2,
      attention: 1,
      connecting: 1,
    })
  })
})

describe("connectionDisplayState", () => {
  it("says awaiting events — not configuring — when only the first payment is missing", () => {
    const health = deriveConnectionHealth({ ...base, lastEventAt: null, events: 0, payments: 0, paymentsWithCommission: 0 }, NOW)
    expect(health.overall).toBe("connecting")
    expect(connectionDisplayState(health, "connected")).toBe("awaitingEvents")
    expect(displayTone("awaitingEvents")).toBe("neutral")
  })

  it("keeps configuring while a founder-only step is pending", () => {
    const health = deriveConnectionHealth(
      { ...base, status: "pending", lastEventAt: null, events: 0, payments: 0, paymentsWithCommission: 0 },
      NOW,
    )
    expect(connectionDisplayState(health, "pending")).toBe("connecting")
  })
})

describe("workspaceStatus", () => {
  const ok = { trackerDetected: true, identityDetected: true }

  it("is all good only when tracker, identity and every account work", () => {
    expect(workspaceStatus({ ...ok, states: ["healthy", "healthy"] }).key).toBe("allGood")
  })

  it("never turns green from a count of connections", () => {
    expect(workspaceStatus({ ...ok, states: ["awaitingEvents", "awaitingEvents", "awaitingEvents"] }).key).toBe("awaitingEvents")
    expect(workspaceStatus({ trackerDetected: false, identityDetected: true, states: ["healthy"] }).key).toBe("incomplete")
    expect(workspaceStatus({ ...ok, states: [] }).key).toBe("incomplete")
    expect(workspaceStatus({ ...ok, states: ["healthy", "connecting"] }).key).toBe("incomplete")
  })

  it("counts what needs attention, danger when something is broken", () => {
    expect(workspaceStatus({ ...ok, states: ["healthy", "degraded"] })).toEqual({ key: "attention", count: 1, tone: "warning" })
    expect(workspaceStatus({ ...ok, states: ["error", "degraded", "healthy"] })).toEqual({ key: "attention", count: 2, tone: "danger" })
  })
})

describe("connectionPresence", () => {
  const row = { status: "disconnected" as const, disconnectedAt: null, credentialsSaved: false, mode: "webhook_secret" }

  it("keeps a manual Stripe setup that was started and not finished", () => {
    expect(connectionPresence(row)).toBe("setupIncomplete")
  })

  it("hides a real disconnect", () => {
    expect(connectionPresence({ ...row, disconnectedAt: new Date() })).toBe("hidden")
  })

  it("hides an API-key attempt whose key was never stored — a failed attempt is not a setup", () => {
    expect(connectionPresence({ ...row, status: "pending", mode: "api_key" })).toBe("hidden")
  })

  it("shows Mercado Pago pending (token stored, panel step left) and every live connection as they are", () => {
    expect(connectionPresence({ ...row, status: "pending", mode: "api_key", credentialsSaved: true })).toBe("visible")
    expect(connectionPresence({ ...row, status: "connected", credentialsSaved: true })).toBe("visible")
    expect(connectionPresence({ ...row, status: "error", mode: "api_key", credentialsSaved: true })).toBe("visible")
  })

  it("reads as setup incomplete, never as healthy, waiting or error", () => {
    const health = deriveConnectionHealth({ ...base, status: "disconnected", credentialsSaved: false, lastEventAt: null, events: 0 }, NOW)
    expect(connectionDisplayState(health, "disconnected", "setupIncomplete")).toBe("setupIncomplete")
    expect(displayTone("setupIncomplete")).toBe("warning")
    expect(workspaceStatus({ trackerDetected: true, identityDetected: true, states: ["healthy", "setupIncomplete"] }).key).toBe("incomplete")
  })
})
