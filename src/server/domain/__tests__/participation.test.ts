import { describe, expect, it } from "vitest"

import { allowedParticipationTransitions, canTransitionParticipation } from "../participation"

describe("participation transitions", () => {
  it("lets a pending application be approved or rejected, never suspended", () => {
    expect(allowedParticipationTransitions("pending")).toEqual(["approved", "rejected"])
    expect(canTransitionParticipation("pending", "suspended")).toBe(false)
  })

  it("only suspends an approved affiliate", () => {
    expect(allowedParticipationTransitions("approved")).toEqual(["suspended"])
    expect(canTransitionParticipation("approved", "approved")).toBe(false)
    expect(canTransitionParticipation("approved", "rejected")).toBe(false)
  })

  it("brings suspended and rejected affiliates back only by approving them", () => {
    expect(allowedParticipationTransitions("suspended")).toEqual(["approved"])
    expect(allowedParticipationTransitions("rejected")).toEqual(["approved"])
    expect(canTransitionParticipation("rejected", "suspended")).toBe(false)
  })
})
