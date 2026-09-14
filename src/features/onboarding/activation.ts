/**
 * The founder's activation checklist, derived purely from facts the overview
 * already reads — no query of its own. Kept free of I/O so the ordering and
 * the "what is next" rule are unit-tested rather than eyeballed.
 */

export const ACTIVATION_STEPS = ["workspace", "program", "stripe", "affiliate", "tracking"] as const

export type ActivationStepKey = (typeof ACTIVATION_STEPS)[number]

export interface ActivationSignals {
  hasProgram: boolean
  stripeConnected: boolean
  hasAffiliate: boolean
  /** At least one referral click recorded, ever — proof the tracker is live. */
  hasClick: boolean
}

export interface Activation {
  steps: { key: ActivationStepKey; done: boolean }[]
  doneCount: number
  total: number
  /** The first pending step, or null when everything is done. */
  next: ActivationStepKey | null
}

/**
 * Maps the rows of existing read functions onto the signals:
 * `listPrograms` (count and all-time `clickCount`), `listIntegrations`
 * (Stripe `connected`) and `listAffiliates(...).total`.
 */
export function activationSignals(input: {
  programs: readonly { clickCount: number | string }[]
  integrations: readonly { provider: string; status: string }[]
  affiliateTotal: number
}): ActivationSignals {
  return {
    hasProgram: input.programs.length > 0,
    stripeConnected: input.integrations.some(
      (integration) => integration.provider === "stripe" && integration.status === "connected",
    ),
    hasAffiliate: input.affiliateTotal > 0,
    hasClick: input.programs.some((program) => Number(program.clickCount) > 0),
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
    stripe: signals.stripeConnected,
    affiliate: signals.hasAffiliate,
    tracking: signals.hasClick,
  }

  const steps = ACTIVATION_STEPS.map((key) => ({ key, done: done[key] }))
  const doneCount = steps.filter((step) => step.done).length

  return {
    steps,
    doneCount,
    total: steps.length,
    next: steps.find((step) => !step.done)?.key ?? null,
  }
}
