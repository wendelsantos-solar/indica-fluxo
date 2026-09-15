import { describe, expect, it } from "vitest"

import {
  buildPayoutCsv,
  buildPayoutTsv,
  csvFormatForLocale,
  escapeCsvField,
  minorToDecimalString,
  neutraliseFormula,
  payoutCsvFilename,
  UTF8_BOM,
  type PayoutExportColumns,
} from "../csv"

const COLUMNS: PayoutExportColumns = {
  affiliate: "Afiliado",
  email: "E-mail",
  amount: "Valor",
  currency: "Moeda",
  commissions: "Comissões",
  batch: "Lote",
}

describe("minorToDecimalString", () => {
  it("splits minor units by the currency's exponent without floats", () => {
    expect(minorToDecimalString(123456, "BRL", ",")).toBe("1234,56")
    expect(minorToDecimalString(123456, "USD", ".")).toBe("1234.56")
    expect(minorToDecimalString(5, "EUR")).toBe("0.05")
    expect(minorToDecimalString(100, "usd")).toBe("1.00")
    expect(minorToDecimalString(0, "BRL", ",")).toBe("0,00")
  })

  it("keeps zero-decimal currencies whole", () => {
    expect(minorToDecimalString(1500, "JPY")).toBe("1500")
  })

  it("keeps the sign", () => {
    expect(minorToDecimalString(-5, "USD")).toBe("-0.05")
  })

  it("is exact past float precision", () => {
    expect(minorToDecimalString(9_007_199_254_740_991, "USD")).toBe("90071992547409.91")
  })

  it("refuses a fractional minor amount", () => {
    expect(() => minorToDecimalString(1.5, "USD")).toThrow(RangeError)
  })
})

describe("escapeCsvField", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvField("Ana Souza", ";")).toBe("Ana Souza")
  })

  it("quotes the delimiter, semicolons, quotes and line breaks", () => {
    expect(escapeCsvField("Souza; Ana", ";")).toBe('"Souza; Ana"')
    expect(escapeCsvField("Souza, Ana", ";")).toBe("Souza, Ana")
    expect(escapeCsvField("Souza; Ana", ",")).toBe('"Souza; Ana"')
    expect(escapeCsvField("Souza, Ana", ",")).toBe('"Souza, Ana"')
    expect(escapeCsvField('Ana "Ninja"', ",")).toBe('"Ana ""Ninja"""')
    expect(escapeCsvField("line\nbreak", ",")).toBe('"line\nbreak"')
  })
})

describe("neutraliseFormula", () => {
  it("prefixes cells a spreadsheet would evaluate", () => {
    expect(neutraliseFormula("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")")
    expect(neutraliseFormula("+55 11")).toBe("'+55 11")
    expect(neutraliseFormula("-1")).toBe("'-1")
    expect(neutraliseFormula("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(neutraliseFormula("Ana")).toBe("Ana")
  })
})

describe("buildPayoutCsv", () => {
  const rows = [
    { affiliateName: "João; Silva", affiliateEmail: "joao@example.com", amountMinor: 123456, currency: "brl", commissionCount: 3 },
    { affiliateName: "=cmd", affiliateEmail: "x@example.com", amountMinor: 7, currency: "BRL", commissionCount: 1 },
  ]

  it("starts with a UTF-8 BOM and uses the pt-BR convention", () => {
    const csv = buildPayoutCsv({ columns: COLUMNS, rows, batchLabel: "Setembro de 2026", format: csvFormatForLocale("pt-br") })
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Afiliado;E-mail;Valor;Moeda;Comissões;Lote",
      '"João; Silva";joao@example.com;1234,56;BRL;3;Setembro de 2026',
      "'=cmd;x@example.com;0,07;BRL;1;Setembro de 2026",
      "",
    ])
  })

  it("uses commas and a decimal point in English", () => {
    const csv = buildPayoutCsv({
      columns: COLUMNS,
      rows: [rows[0]!],
      batchLabel: "September 2026 #2",
      format: csvFormatForLocale("en"),
    })
    expect(csv.slice(1).split("\r\n")[1]).toBe('"João; Silva",joao@example.com,1234.56,BRL,3,September 2026 #2')
  })
})

describe("buildPayoutTsv", () => {
  it("joins with tabs, no BOM, and flattens tabs and line breaks", () => {
    const tsv = buildPayoutTsv({
      columns: COLUMNS,
      rows: [{ affiliateName: "Ana\tSouza\n", affiliateEmail: "ana@example.com", amountMinor: 1000, currency: "USD", commissionCount: 2 }],
      batchLabel: "Setembro de 2026",
      decimalSeparator: ",",
    })
    expect(tsv.startsWith(UTF8_BOM)).toBe(false)
    expect(tsv.split("\n")).toEqual([
      "Afiliado\tE-mail\tValor\tMoeda\tComissões\tLote",
      "Ana Souza \tana@example.com\t10,00\tUSD\t2\tSetembro de 2026",
    ])
  })
})

describe("payoutCsvFilename", () => {
  it("names the file by workspace, prefix and batch month", () => {
    const periodEnd = new Date(Date.UTC(2026, 8, 30))
    expect(payoutCsvFilename({ workspaceSlug: "acme", periodEnd, reference: "September 2026", prefix: "pagamentos" })).toBe(
      "acme-pagamentos-2026-09.csv",
    )
    expect(payoutCsvFilename({ workspaceSlug: "acme", periodEnd, reference: "September 2026 #3", prefix: "Pagamentos" })).toBe(
      "acme-pagamentos-2026-09-3.csv",
    )
  })

  it("keeps the header ASCII", () => {
    const name = payoutCsvFilename({
      workspaceSlug: "ação",
      periodEnd: new Date(Date.UTC(2026, 0, 31)),
      reference: "January 2026",
      prefix: "lote \"x\"",
    })
    expect(name).toBe("acao-lote-x-2026-01.csv")
  })
})
