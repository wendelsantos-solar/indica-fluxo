import type { Standing } from "@/server/domain/entitlements"

export type BillingBannerKind = "grace" | "restricted" | "ending"

/**
 * Which workspace-wide billing banner applies, if any (docs/PLANS.md §6).
 * A payment problem outranks a scheduled end; Sandbox and a renewing plan
 * show nothing.
 */
export function billingBannerKind(input: { standing: Standing; endsAt: Date | null }): BillingBannerKind | null {
  if (input.standing === "restricted") return "restricted"
  if (input.standing === "grace") return "grace"
  if (input.standing === "active" && input.endsAt) return "ending"
  return null
}
