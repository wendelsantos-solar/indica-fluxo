import { describe, expect, it } from "vitest"

import { formatMoney } from "../money"
import {
  amountIn,
  formatMoneyTotals,
  formatMoneyTotalsInline,
  hasNonZeroTotal,
  orderMoneyTotals,
  pickPrimaryCurrency,
  subtractMoneyTotals,
  toMoneyTotals,
} from "../money-totals"

const norm = (value: string) => value.replace(/ /g, " ").replace(/ /g, " ")
const money = (amountMinor: number, currency: string) => formatMoney("pt-br", amountMinor, currency)

describe("toMoneyTotals", () => {
  it("coerces bigint-as-string rows and merges padded, mixed-case currencies", () => {
    expect(
      toMoneyTotals([
        { currency: "usd", amountMinor: "3000000000" },
        { currency: "USD", amountMinor: 5 },
        { currency: "BRL", amountMinor: null },
      ]),
    ).toEqual([
      { currency: "USD", amountMinor: 3_000_000_005 },
      { currency: "BRL", amountMinor: 0 },
    ])
  })

  it("keeps sums above the int4 range exact", () => {
    const [total] = toMoneyTotals([{ currency: "BRL", amountMinor: "2147483648" }])
    expect(total?.amountMinor).toBe(2_147_483_648)
  })
})

describe("orderMoneyTotals", () => {
  const totals = [
    { currency: "EUR", amountMinor: 12_000 },
    { currency: "BRL", amountMinor: 100 },
    { currency: "GBP", amountMinor: 8_000 },
    { currency: "USD", amountMinor: -50_000 },
  ]

  it("puts the primary currency first, then by magnitude", () => {
    expect(orderMoneyTotals(totals, "brl").map((t) => t.currency)).toEqual([
      "BRL",
      "USD",
      "EUR",
      "GBP",
    ])
  })

  it("orders purely by magnitude without a primary", () => {
    expect(orderMoneyTotals(totals).map((t) => t.currency)).toEqual(["USD", "EUR", "GBP", "BRL"])
  })
})

describe("pickPrimaryCurrency", () => {
  it("prefers the workspace default when it has activity", () => {
    expect(
      pickPrimaryCurrency("BRL", [
        { currency: "USD", amountMinor: 900_000 },
        { currency: "BRL", amountMinor: 1 },
      ]),
    ).toBe("BRL")
  })

  it("falls back to the currency with the most activity", () => {
    expect(
      pickPrimaryCurrency("BRL", [
        { currency: "EUR", amountMinor: 100 },
        { currency: "USD", amountMinor: 900 },
      ]),
    ).toBe("USD")
  })

  it("consults later lists only when earlier ones are empty", () => {
    expect(pickPrimaryCurrency("BRL", [], [{ currency: "EUR", amountMinor: 1 }])).toBe("EUR")
  })

  it("returns the default when there is no activity at all", () => {
    expect(pickPrimaryCurrency("brl", [{ currency: "USD", amountMinor: 0 }])).toBe("BRL")
  })
})

describe("arithmetic stays per currency", () => {
  it("subtracts matching currencies only", () => {
    const net = subtractMoneyTotals(
      [
        { currency: "BRL", amountMinor: 10_000 },
        { currency: "USD", amountMinor: 5_000 },
      ],
      [
        { currency: "BRL", amountMinor: 3_000 },
        { currency: "EUR", amountMinor: 200 },
      ],
    )
    expect(amountIn(net, "BRL")).toBe(7_000)
    expect(amountIn(net, "USD")).toBe(5_000)
    expect(amountIn(net, "EUR")).toBe(-200)
  })

  it("detects any non-zero total", () => {
    expect(hasNonZeroTotal([{ currency: "BRL", amountMinor: 0 }])).toBe(false)
    expect(hasNonZeroTotal([{ currency: "BRL", amountMinor: -1 }])).toBe(true)
  })
})

describe("formatMoneyTotals", () => {
  it("shows the primary figure and the other currencies separately, never summed", () => {
    const result = formatMoneyTotals(
      money,
      [
        { currency: "GBP", amountMinor: 8_000 },
        { currency: "BRL", amountMinor: 123_456 },
        { currency: "EUR", amountMinor: 12_000 },
        { currency: "USD", amountMinor: 0 },
      ],
      "BRL",
    )
    expect(norm(result.primary)).toBe("R$ 1.234,56")
    expect(norm(result.others ?? "")).toBe("€ 120,00 · £ 80,00")
  })

  it("renders a zero primary rather than an empty value, and no others line", () => {
    const result = formatMoneyTotals(money, [], "BRL")
    expect(norm(result.primary)).toBe("R$ 0,00")
    expect(result.others).toBeNull()
  })

  it("inlines every non-zero currency, dropping a zero primary", () => {
    expect(
      norm(
        formatMoneyTotalsInline(
          money,
          [
            { currency: "BRL", amountMinor: 90_000 },
            { currency: "USD", amountMinor: 4_000 },
          ],
          "BRL",
        ),
      ),
    ).toBe("R$ 900,00 · US$ 40,00")
    expect(norm(formatMoneyTotalsInline(money, [{ currency: "USD", amountMinor: 4_000 }], "BRL"))).toBe(
      "US$ 40,00",
    )
    expect(norm(formatMoneyTotalsInline(money, [], "BRL"))).toBe("R$ 0,00")
  })
})
