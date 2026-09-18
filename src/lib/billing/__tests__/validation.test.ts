import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CONNECTOR_IDS, CONNECTORS } from "../catalog"
import {
  PROVIDER_VALIDATION,
  STABLE_BEFORE_LEDGER,
  VALIDATION_ITEMS,
  evidencedMaturity,
  maturityGate,
} from "../validation"

/**
 * Beta → Stable only with evidence (brief §15–§16). These tests are the gate:
 * flipping a connector to `stable`/`public` without a complete real-account
 * ledger fails CI. Unit, contract and DB tests are required but never enough.
 */
describe("provider maturity gate", () => {
  it("never declares a maturity above what the evidence supports", () => {
    const rank = { coming_soon: 0, beta_implemented: 1, beta_real_tested: 2, stable: 3 } as const
    for (const id of CONNECTOR_IDS) {
      expect(rank[CONNECTORS[id].maturity], id).toBeLessThanOrEqual(rank[evidencedMaturity(id)])
    }
  })

  it("public availability requires stable maturity, and stable requires a complete ledger", () => {
    for (const id of CONNECTOR_IDS) {
      const descriptor = CONNECTORS[id]
      if (descriptor.defaultAvailability === "public") expect(descriptor.maturity, id).toBe("stable")
      if (descriptor.maturity === "stable") expect(maturityGate(id).canBeStable, id).toBe(true)
      if (descriptor.defaultAvailability === "beta") expect(descriptor.maturity, id).toMatch(/^beta_/)
    }
  })

  it("keeps Mercado Pago, AbacatePay and Asaas in beta until real round trips exist", () => {
    for (const id of ["mercado_pago", "abacatepay", "asaas"] as const) {
      expect(CONNECTORS[id].defaultAvailability).toBe("beta")
      expect(maturityGate(id).canBeStable).toBe(false)
    }
    expect(STABLE_BEFORE_LEDGER).toEqual(["stripe"])
  })

  it("every ledger row is complete: PASS carries date, environment and evidence; N/A carries a reason", () => {
    for (const [id, ledger] of Object.entries(PROVIDER_VALIDATION)) {
      expect(Object.keys(ledger).sort(), id).toEqual([...VALIDATION_ITEMS].sort())
      for (const [item, entry] of Object.entries(ledger)) {
        if (entry.result === "PASS") expect(entry.date && entry.environment && entry.evidence, `${id}.${item}`).toBeTruthy()
        if (entry.result === "N/A") expect(entry.notes, `${id}.${item}`).toBeTruthy()
      }
    }
  })

  it("stores no secret-looking value in the evidence", () => {
    const shapes = /(APP_USR-|TEST-\d|\$aact_|abc_(prod|dev)_|whsec_|sk_(live|test)_|@[a-z0-9-]+\.)/i
    for (const ledger of Object.values(PROVIDER_VALIDATION)) {
      for (const entry of Object.values(ledger)) expect(`${entry.evidence ?? ""} ${entry.notes ?? ""}`).not.toMatch(shapes)
    }
  })

  it("the human checklist mirrors the ledger's items", () => {
    const doc = readFileSync(join(process.cwd(), "PROVIDER_PRODUCTION_VALIDATION.md"), "utf8")
    for (const item of VALIDATION_ITEMS) expect(doc, item).toContain(`\`${item}\``)
  })
})
