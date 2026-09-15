/**
 * The founder's activation checklist, derived purely from facts the overview
 * already reads. Kept free of I/O so the ordering, the "what is next" rule and
 * the checklist-versus-dashboard gate are unit-tested rather than eyeballed.
 */

export const ACTIVATION_STEPS = ["workspace", "program", "stripe", "affiliate", "tracking"] as const

export type ActivationStepKey = (typeof ACTIVATION_STEPS)[number]

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
}

/**
 * Maps existing reads onto the signals: `listPrograms` (count and all-time
 * `clickCount`), `getIntegrationHealth` (Stripe configured / last event, last
 * click) and `listAffiliates(...).total`.
 */
export function activationSignals(input: {
  programs: readonly { clickCount: number | string }[]
  health: ActivationHealth
  affiliateTotal: number
}): ActivationSignals {
  return {
    hasProgram: input.programs.length > 0,
    stripeConfigured: input.health.stripe.configured,
    stripeEventReceived: input.health.stripe.lastEventAt !== null,
    hasAffiliate: input.affiliateTotal > 0,
    hasClick:
      input.health.tracking.lastClickAt !== null ||
      input.programs.some((program) => Number(program.clickCount) > 0),
  }
}

/**
 * Order follows dependency, not importance: tracking can only be verified by a
 * click, and a click needs an affiliate's link — so "invite" comes before
 * "install tracking", or the checklist would point at a step the founder has
 * already finished but cannot yet prove.
 */
export function getActivation(signals: ActivationSignals): Activation {
  const done: Record<ActivationStepKey, boolean> = {
    // The overview only renders inside a workspace.
    workspace: true,
    program: signals.hasProgram,
    stripe: signals.stripeEventReceived,
    affiliate: signals.hasAffiliate,
    tracking: signals.hasClick,
  }

  const steps = ACTIVATION_STEPS.map((key) => ({
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
