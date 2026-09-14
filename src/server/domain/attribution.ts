import type { AttributionModel } from "./types"

/**
 * Attribution is the join between anonymous traffic and money, so it is a pure
 * function with an explicit clock: given the current attribution state and a
 * new click, decide what the stored row should become.
 *
 * Rules, in order:
 *  1. No existing attribution (or an expired one) → the click wins outright.
 *  2. `last_click` → the newest click always wins and the window restarts.
 *  3. `first_click` → the original affiliate keeps the credit while the window
 *     is open; the click is still recorded and updates `lastClickId` so the
 *     founder can see the overlap, but it does not move the money.
 */

export interface AttributionState {
  programAffiliateId: string
  firstClickId: string | null
  lastClickId: string | null
  attributedAt: Date
  expiresAt: Date
}

export interface IncomingClick {
  clickId: string
  programAffiliateId: string
  occurredAt: Date
}

export interface AttributionDecision {
  /** `create` when there is no usable existing row. */
  action: "create" | "replace" | "touch" | "ignore"
  programAffiliateId: string
  firstClickId: string
  lastClickId: string
  attributedAt: Date
  expiresAt: Date
  reason: string
}

export function isExpired(state: Pick<AttributionState, "expiresAt">, now: Date): boolean {
  return state.expiresAt.getTime() <= now.getTime()
}

export function expiryFrom(occurredAt: Date, windowDays: number): Date {
  return new Date(occurredAt.getTime() + windowDays * 24 * 60 * 60 * 1000)
}

export function resolveAttribution(params: {
  current: AttributionState | null
  click: IncomingClick
  model: AttributionModel
  windowDays: number
  now: Date
}): AttributionDecision {
  const { current, click, model, windowDays, now } = params
  const expiresAt = expiryFrom(click.occurredAt, windowDays)

  if (!current) {
    return {
      action: "create",
      programAffiliateId: click.programAffiliateId,
      firstClickId: click.clickId,
      lastClickId: click.clickId,
      attributedAt: click.occurredAt,
      expiresAt,
      reason: "no prior attribution",
    }
  }

  if (isExpired(current, now)) {
    return {
      action: "replace",
      programAffiliateId: click.programAffiliateId,
      firstClickId: click.clickId,
      lastClickId: click.clickId,
      attributedAt: click.occurredAt,
      expiresAt,
      reason: "prior attribution expired",
    }
  }

  if (model === "last_click") {
    const changed = current.programAffiliateId !== click.programAffiliateId
    return {
      action: changed ? "replace" : "touch",
      programAffiliateId: click.programAffiliateId,
      firstClickId: current.firstClickId ?? click.clickId,
      lastClickId: click.clickId,
      attributedAt: click.occurredAt,
      // Last-click restarts the window on every qualifying click.
      expiresAt,
      reason: changed ? "last-click reassignment" : "last-click refresh",
    }
  }

  // first_click: credit is locked for the life of the window.
  return {
    action: "touch",
    programAffiliateId: current.programAffiliateId,
    firstClickId: current.firstClickId ?? click.clickId,
    lastClickId: click.clickId,
    attributedAt: current.attributedAt,
    expiresAt: current.expiresAt,
    reason:
      current.programAffiliateId === click.programAffiliateId
        ? "first-click retained"
        : "first-click retained over a later affiliate",
  }
}

/** A conversion only counts while the attribution window is still open. */
export function isAttributionValidAt(
  state: Pick<AttributionState, "expiresAt">,
  at: Date,
): boolean {
  return state.expiresAt.getTime() > at.getTime()
}
