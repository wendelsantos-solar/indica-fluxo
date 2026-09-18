/**
 * The founder's activation checklist, derived purely from facts the overview
 * already reads. Kept free of I/O so the ordering, the "what is next" rule and
 * the checklist-versus-dashboard gate are unit-tested rather than eyeballed.
 */

export const ACTIVATION_STEPS = [
  "workspace",
  "program",
  "affiliate",
  "testConversion",
  "tracking",
  "identity",
  "stripe",
  "liveMode",
] as const

/**
 * The journey in three phases, so ten things to do read as three
 * (brief §29): see a commission first, then connect the SaaS once, then go live.
 * `stripe` is the historical key of "a payment method is connected and sends
 * events" — any provider, not only Stripe (migration 0018).
 */
export const ACTIVATION_PHASES = [
  { key: "try", steps: ["workspace", "program", "affiliate", "testConversion"] },
  { key: "connect", steps: ["tracking", "identity", "stripe"] },
  { key: "live", steps: ["liveMode"] },
] as const satisfies ReadonlyArray<{ key: string; steps: readonly ActivationStepKey[] }>

/**
 * The Sandbox journey (docs/PLANS.md §2): prove a conversion in test, then
 * activate live mode. Only part of the checklist when the caller passes the
 * plan signal (`liveMode`), so an overview that does not read the plan keeps
 * the original five steps.
 */
export const SANDBOX_STEPS = ["testConversion", "liveMode"] as const

export type ActivationStepKey =
  | "workspace"
  | "program"
  | "affiliate"
  | "testConversion"
  | "tracking"
  | "identity"
  | "stripe"
  | "liveMode"

export interface ActivationSignals {
  hasProgram: boolean
  /**
   * Stripe credentials are saved, but that alone proves nothing: the step is
   * only done once `stripeEventReceived` is true.
   */
  stripeConfigured: boolean
  /** At least one Stripe webhook event has been received, ever. */
  stripeEventReceived: boolean
  hasAffiliate: boolean
  /** At least one referral click recorded, ever — proof the tracker is live. */
  hasClick: boolean
  /**
   * A customer was identified by the SaaS (`/api/identify`), ever. `undefined`
   * leaves the step out, so a caller that does not read it keeps the old list.
   */
  hasIdentity?: boolean
  /** A test-program commission exists, ever (a simulated or test-mode conversion). */
  hasTestCommission?: boolean
  /** A live-program commission exists, ever: the pipeline is proven in production. */
  hasLiveCommission?: boolean
  /**
   * The plan's `liveMode` right now (`entitlements.capabilities.features.liveMode`).
   * `undefined` leaves the Sandbox steps out of the checklist.
   */
  liveMode?: boolean
}

export interface ActivationStep {
  key: ActivationStepKey
  done: boolean
  /** Set up but not yet proven by real data (Stripe saved, no event yet). */
  waiting: boolean
}

export interface Activation {
  steps: ActivationStep[]
  doneCount: number
  total: number
  /** The first pending step, or null when everything is done. */
  next: ActivationStepKey | null
}

/** The subset of `getIntegrationHealth()` the checklist reads. */
export interface ActivationHealth {
  stripe: { configured: boolean; lastEventAt: Date | null }
  tracking: { lastClickAt: Date | null }
  /** Optional: when present, the customer-identity step joins the checklist. */
  attribution?: Record<"test" | "live", { lastIdentifyAt: Date | null }>
}

/**
 * Maps existing reads onto the signals: `listPrograms` (count and all-time
 * `clickCount`), `getIntegrationHealth` (Stripe configured / last event, last
 * click) and `listAffiliates(...).total`.
 */
export function activationSignals(input: {
  programs: readonly {
    clickCount: number | string
    /** From `listPrograms`; needed for the Sandbox steps. */
    environment?: "test" | "live"
    /** From `listPrograms` (non-rejected commissions per currency). */
    commissionTotals?: readonly unknown[]
  }[]
  health: ActivationHealth
  affiliateTotal: number
  /** `entitlements.capabilities.features.liveMode`. Omit to leave the Sandbox steps out. */
  liveMode?: boolean
}): ActivationSignals {
  const signals: ActivationSignals = {
    hasProgram: input.programs.length > 0,
    stripeConfigured: input.health.stripe.configured,
    stripeEventReceived: input.health.stripe.lastEventAt !== null,
    hasAffiliate: input.affiliateTotal > 0,
    hasClick:
      input.health.tracking.lastClickAt !== null ||
      input.programs.some((program) => Number(program.clickCount) > 0),
  }
  if (input.health.attribution) {
    signals.hasIdentity = Boolean(
      input.health.attribution.test.lastIdentifyAt || input.health.attribution.live.lastIdentifyAt,
    )
  }
  if (input.liveMode === undefined) return signals

  const earned = (environment: "test" | "live") =>
    input.programs.some(
      (program) => program.environment === environment && (program.commissionTotals?.length ?? 0) > 0,
    )
  return {
    ...signals,
    hasTestCommission: earned("test"),
    hasLiveCommission: earned("live"),
    liveMode: input.liveMode,
  }
}

/**
 * Order follows dependency first and value second, in that order.
 *
 * Dependency: tracking can only be verified by a click, and a click needs an
 * affiliate's link — so "invite" comes before "install tracking", or the
 * checklist would point at a step the founder has already finished but cannot
 * yet prove. A test conversion needs an approved affiliate too.
 *
 * Value: the simulated conversion runs through the real services and needs no
 * Stripe and no code at all (`src/server/services/sandbox.ts`), so it comes
 * **before** Stripe. A founder should see a commission calculated — the one
 * thing that proves the product — before being asked to connect an account or
 * deploy anything (INTEGRATION_ARCHITECTURE_V2.md §10). Live mode stays last,
 * once the whole path is proven in test.
 */
export function getActivation(signals: ActivationSignals): Activation {
  const done: Record<ActivationStepKey, boolean> = {
    // The overview only renders inside a workspace.
    workspace: true,
    program: signals.hasProgram,
    stripe: signals.stripeEventReceived,
    affiliate: signals.hasAffiliate,
    // A live commission proves more than a test one: nothing left to rehearse.
    testConversion: Boolean(signals.hasTestCommission || signals.hasLiveCommission),
    tracking: signals.hasClick,
    identity: Boolean(signals.hasIdentity),
    liveMode: Boolean(signals.liveMode),
  }

  const withSandbox = signals.liveMode !== undefined
  const withIdentity = signals.hasIdentity !== undefined
  const keys = ACTIVATION_STEPS.filter(
    (key) =>
      (withSandbox || !(SANDBOX_STEPS as readonly string[]).includes(key)) && (withIdentity || key !== "identity"),
  )

  const steps = keys.map((key) => ({
    key,
    done: done[key],
    waiting: key === "stripe" && !done.stripe && signals.stripeConfigured,
  }))
  const doneCount = steps.filter((step) => step.done).length

  return {
    steps,
    doneCount,
    total: steps.length,
    next: steps.find((step) => !step.done)?.key ?? null,
  }
}

/**
 * Whether the overview leads with the checklist instead of the dashboard.
 *
 * Only while activation is genuinely incomplete AND nothing has ever happened:
 * a quiet month in a set-up workspace is still a dashboard (with honest empty
 * states), and money that is owed always keeps the dashboard — and its
 * "ready to pay" callout — on screen, whatever step is still missing.
 */
export function shouldShowActivationChecklist(input: {
  activation: Activation
  /** Any commission recorded, ever (payable or not). */
  hasCommission: boolean
  /** Commissions ready to pay or still on hold right now. */
  hasOutstandingMoney: boolean
}): boolean {
  if (input.activation.next === null) return false
  if (input.hasCommission || input.hasOutstandingMoney) return false
  const clickStep = input.activation.steps.find((step) => step.key === "tracking")
  // A click proves the program is live; from then on the dashboard has
  // something true to say, and the missing step becomes a one-line reminder.
  return !clickStep?.done
}
