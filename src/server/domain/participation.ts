/**
 * Which moves a founder may make on an affiliate's participation in a program.
 * Pure, so the service and the row menu agree on the same table.
 *
 *   pending   → approved | rejected
 *   approved  → suspended
 *   suspended → approved
 *   rejected  → approved
 *
 * Suspending a pending application or rejecting someone already earning is not
 * offered: the first has nothing to suspend, the second is what "suspend" is for.
 */

export type ParticipationStatus = "pending" | "approved" | "rejected" | "suspended"
export type ParticipationTarget = Exclude<ParticipationStatus, "pending">

const TRANSITIONS: Record<ParticipationStatus, readonly ParticipationTarget[]> = {
  pending: ["approved", "rejected"],
  approved: ["suspended"],
  suspended: ["approved"],
  rejected: ["approved"],
}

export function allowedParticipationTransitions(
  from: ParticipationStatus,
): readonly ParticipationTarget[] {
  return TRANSITIONS[from]
}

export function canTransitionParticipation(
  from: ParticipationStatus,
  to: ParticipationTarget,
): boolean {
  return TRANSITIONS[from].includes(to)
}
