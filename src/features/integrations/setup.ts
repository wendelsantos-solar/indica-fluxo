/**
 * The integration setup, derived from evidence (brief §58–§60). Pure and
 * tested: "ready" never needs every provider — the tracker, a customer link
 * and one working provider are enough, and the rest can come later.
 */

import type { ConnectorId } from "@/lib/billing/catalog"

import type { OverallHealth } from "./health"

export type SetupStepKey = "tracker" | "identity" | "choose" | "connect" | "test"

export interface SetupStep {
  key: SetupStepKey
  /** For `connect`: which provider. */
  provider?: ConnectorId
  done: boolean
  /** Not needed for "ready" (a second provider, a provider left for later). */
  optional: boolean
  /**
   * For `connect`: a connection exists but is not working yet — `waiting` for
   * its first event, or `attention` (refused key, rejected signature, errors).
   * Only a working connection ticks the step: "connected" is not "done".
   * `incomplete`: a manual setup was started and not finished (no credential yet).
   */
  state?: "waiting" | "attention" | "incomplete"
  /** For `incomplete`: the connection to resume. */
  connectionId?: string
}

export interface SetupInput {
  trackerDetected: boolean
  /** An identify call, or a checkout reference bound by a provider event. */
  identityDetected: boolean
  selection: ConnectorId[] | null
  connections: Array<{ provider: string; overall: OverallHealth; events: number; payments: number; incomplete?: boolean; id?: string }>
}

export interface SetupState {
  steps: SetupStep[]
  done: number
  total: number
  ready: boolean
  /** Something is expected to arrive on its own: keep re-reading the page. */
  waiting: boolean
}

const WORKING: ReadonlySet<OverallHealth> = new Set(["healthy", "degraded"])

export function deriveSetup(input: SetupInput): SetupState {
  const active = input.connections.filter((connection) => connection.overall !== "notConnected")
  const incomplete = input.connections.filter((connection) => connection.incomplete)
  const working = active.filter((connection) => WORKING.has(connection.overall) && connection.events > 0)

  // Providers chosen, plus any connected without being chosen.
  const providers = [
    ...new Set([
      ...(input.selection ?? []),
      ...[...active, ...incomplete].map((connection) => connection.provider as ConnectorId),
    ]),
  ]

  const connectSteps: SetupStep[] = providers.map((provider, index) => {
    const own = active.filter((connection) => connection.provider === provider)
    const done = own.some((connection) => WORKING.has(connection.overall))
    const state = done
      ? undefined
      : own.some((connection) => connection.overall === "actionRequired" || connection.overall === "error")
        ? ("attention" as const)
        : own.some((connection) => connection.overall === "connecting")
          ? ("waiting" as const)
          : incomplete.some((connection) => connection.provider === provider)
            ? ("incomplete" as const)
            : undefined
    const resume = state === "incomplete" ? incomplete.find((connection) => connection.provider === provider)?.id : undefined
    return {
      key: "connect",
      provider,
      ...(resume ? { connectionId: resume } : {}),
      done,
      // One provider is required; the others never block production.
      optional: index > 0 || working.length > 0,
      ...(state ? { state } : {}),
    }
  })
  if (connectSteps.length === 0) connectSteps.push({ key: "connect", done: false, optional: false })
  else if (connectSteps.every((step) => step.optional) && working.length === 0) connectSteps[0]!.optional = false

  const steps: SetupStep[] = [
    { key: "tracker", done: input.trackerDetected, optional: false },
    { key: "identity", done: input.identityDetected, optional: false },
    { key: "choose", done: input.selection !== null || active.length > 0 || incomplete.length > 0, optional: true },
    ...connectSteps,
    { key: "test", done: input.connections.some((connection) => connection.payments > 0), optional: false },
  ]

  const ready = input.trackerDetected && input.identityDetected && working.length > 0
  const waiting =
    !ready &&
    (!input.trackerDetected || !input.identityDetected || active.some((connection) => connection.overall === "connecting"))

  return { steps, done: steps.filter((step) => step.done).length, total: steps.length, ready, waiting }
}
