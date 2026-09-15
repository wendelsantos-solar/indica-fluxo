import { describe, expect, it } from "vitest"

import {
  deriveStripeState,
  formatRelativeTime,
  needsSetup,
  stripeBadgeStatus,
  type StripeStatusInput,
} from "../stripe-status"

const t0 = new Date("2026-09-14T10:00:00Z")
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)

function input(overrides: Partial<NonNullable<StripeStatusInput["integration"]>> | null, rest: Partial<StripeStatusInput> = {}): StripeStatusInput {
  return {
    integration:
      overrides === null
        ? null
        : {
            status: "connected",
            secretSaved: true,
            secretSavedAt: t0,
            lastRejectedAt: null,
            ...overrides,
          },
    lastEventAt: null,
    lastEventFailed: false,
    ...rest,
  }
}

describe("deriveStripeState", () => {
  it("starts at step 1 with no integration", () => {
    expect(deriveStripeState(input(null))).toBe("notStarted")
  })

  it("asks for the secret once the integration exists without one", () => {
    expect(deriveStripeState(input({ status: "disconnected", secretSaved: false, secretSavedAt: null }))).toBe(
      "awaitingSecret",
    )
  })

  it("is never green on configuration alone: a saved secret waits for the first event", () => {
    const state = deriveStripeState(input({}))
    expect(state).toBe("awaitingFirstEvent")
    expect(stripeBadgeStatus(state)).toBe("pending")
  })

  it("turns green only when an event has arrived", () => {
    const state = deriveStripeState(input({}, { lastEventAt: later(5) }))
    expect(state).toBe("receiving")
    expect(stripeBadgeStatus(state)).toBe("connected")
  })

  it("reports the latest event failing", () => {
    expect(deriveStripeState(input({}, { lastEventAt: later(5), lastEventFailed: true }))).toBe("lastEventFailed")
  })

  it("reports a signature rejection newer than the secret and the last event", () => {
    expect(deriveStripeState(input({ lastRejectedAt: later(10) }, { lastEventAt: later(5) }))).toBe(
      "signatureRejected",
    )
  })

  it("forgets a rejection that predates the saved secret or a later good event", () => {
    expect(deriveStripeState(input({ lastRejectedAt: later(-1) }))).toBe("awaitingFirstEvent")
    expect(deriveStripeState(input({ lastRejectedAt: later(2) }, { lastEventAt: later(5) }))).toBe("receiving")
  })

  it("lets a legacy platform-webhook integration prove itself with events", () => {
    const legacy = { status: "connected" as const, secretSaved: false, secretSavedAt: null }
    expect(deriveStripeState(input(legacy))).toBe("awaitingSecret")
    expect(deriveStripeState(input(legacy, { lastEventAt: later(1) }))).toBe("receiving")
  })

  it("surfaces an integration flagged as error", () => {
    expect(deriveStripeState(input({ status: "error" }, { lastEventAt: later(1) }))).toBe("error")
  })

  it("shows the wizard only before a secret is saved", () => {
    expect(needsSetup("notStarted")).toBe(true)
    expect(needsSetup("awaitingSecret")).toBe(true)
    expect(needsSetup("awaitingFirstEvent")).toBe(false)
    expect(needsSetup("signatureRejected")).toBe(false)
  })
})

describe("formatRelativeTime", () => {
  it("formats in the reader's language", () => {
    expect(formatRelativeTime("en", later(-5), t0)).toBe("5 minutes ago")
    expect(formatRelativeTime("pt-BR", later(-5), t0)).toBe("há 5 minutos")
    expect(formatRelativeTime("en", later(-3 * 24 * 60), t0)).toBe("3 days ago")
  })

  it("says now for anything under a minute", () => {
    expect(formatRelativeTime("en", new Date(t0.getTime() - 20_000), t0)).toBe("now")
  })
})
