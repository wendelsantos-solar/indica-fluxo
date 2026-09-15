import { minorUnitExponent } from "@/lib/money"

import { batchOrdinal } from "./batch-label"

/**
 * The payout export: who to pay, how much, in which currency — the table a
 * founder types into a bank. Pure, so the route handler and the "copy table"
 * button produce exactly the same figures, and so the rules below are tested
 * without a request.
 *
 * Amounts are written as plain decimals in major units ("1234,56"), never as
 * formatted currency ("R$ 1.234,56"): a spreadsheet must read them as numbers.
 * The integer minor amount is split with string arithmetic, so no float ever
 * touches the figure.
 */

export interface PayoutExportRow {
  affiliateName: string
  affiliateEmail: string
  amountMinor: number
  currency: string
  commissionCount: number
}

/** Translated column headers, in output order. */
export interface PayoutExportColumns {
  affiliate: string
  email: string
  amount: string
  currency: string
  commissions: string
  batch: string
}

export interface DelimitedFormat {
  delimiter: ";" | "," | "\t"
  decimalSeparator: "," | "."
}

/**
 * What a spreadsheet opened in that language expects: Excel and Sheets in
 * Portuguese use a decimal comma and therefore a semicolon between fields.
 */
export function csvFormatForLocale(locale: string): DelimitedFormat {
  return locale.toLowerCase().startsWith("pt")
    ? { delimiter: ";", decimalSeparator: "," }
    : { delimiter: ",", decimalSeparator: "." }
}

/** `(123456, "BRL", ",")` → `"1234,56"`; `(1500, "JPY")` → `"1500"`; `(-5, "USD")` → `"-0.05"`. */
export function minorToDecimalString(
  amountMinor: number,
  currency: string,
  decimalSeparator: "," | "." = ".",
): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("amountMinor must be a safe integer")
  const exponent = minorUnitExponent(currency)
  const sign = amountMinor < 0 ? "-" : ""
  const digits = Math.abs(amountMinor).toString()
  if (exponent === 0) return sign + digits
  const padded = digits.padStart(exponent + 1, "0")
  return `${sign}${padded.slice(0, -exponent)}${decimalSeparator}${padded.slice(-exponent)}`
}

/**
 * A cell a spreadsheet would run as a formula (`=HYPERLINK(…)`, `+1`, `@SUM`)
 * is prefixed with an apostrophe. Affiliates choose their own names, so the
 * founder's spreadsheet must not execute them. Applied to text cells only.
 */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * RFC 4180 quoting: a field holding the delimiter, a semicolon (whatever the
 * delimiter — a spreadsheet may be set to split on it), a quote or a line break
 * is quoted, quotes doubled. A decimal comma under `;` stays unquoted.
 */
export function escapeCsvField(value: string, delimiter: DelimitedFormat["delimiter"]): string {
  const needsQuotes = value.includes(delimiter) || /[;"\r\n]/.test(value)
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

function rowsOf(
  columns: PayoutExportColumns,
  rows: PayoutExportRow[],
  batchLabel: string,
  decimalSeparator: DelimitedFormat["decimalSeparator"],
): { header: string[]; body: string[][] } {
  const header = [
    columns.affiliate,
    columns.email,
    columns.amount,
    columns.currency,
    columns.commissions,
    columns.batch,
  ]
  const body = rows.map((row) => [
    neutraliseFormula(row.affiliateName),
    neutraliseFormula(row.affiliateEmail),
    minorToDecimalString(row.amountMinor, row.currency, decimalSeparator),
    row.currency.toUpperCase(),
    String(row.commissionCount),
    neutraliseFormula(batchLabel),
  ])
  return { header, body }
}

/** UTF-8 byte order mark: without it Excel reads "João" as "JoÃ£o". */
export const UTF8_BOM = "\uFEFF"

export function buildPayoutCsv(input: {
  columns: PayoutExportColumns
  rows: PayoutExportRow[]
  batchLabel: string
  format: DelimitedFormat
}): string {
  const { delimiter, decimalSeparator } = input.format
  const { header, body } = rowsOf(input.columns, input.rows, input.batchLabel, decimalSeparator)
  const lines = [header, ...body].map((cells) => cells.map((cell) => escapeCsvField(cell, delimiter)).join(delimiter))
  return `${UTF8_BOM}${lines.join("\r\n")}\r\n`
}

/**
 * Tab-separated, for pasting into a spreadsheet or a bank's bulk form. A paste
 * has no quoting convention, so tabs and line breaks inside a value become
 * spaces instead.
 */
export function buildPayoutTsv(input: {
  columns: PayoutExportColumns
  rows: PayoutExportRow[]
  batchLabel: string
  decimalSeparator: DelimitedFormat["decimalSeparator"]
}): string {
  const { header, body } = rowsOf(input.columns, input.rows, input.batchLabel, input.decimalSeparator)
  return [header, ...body].map((cells) => cells.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n")
}

/** `acme-pagamentos-2026-09.csv`, `acme-pagamentos-2026-09-2.csv`. ASCII only, so the header needs no encoding. */
export function payoutCsvFilename(input: {
  workspaceSlug: string
  periodEnd: Date
  reference: string
  prefix: string
}): string {
  const safe = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  const month = Number.isNaN(input.periodEnd.getTime())
    ? "batch"
    : `${input.periodEnd.getUTCFullYear()}-${String(input.periodEnd.getUTCMonth() + 1).padStart(2, "0")}`
  const ordinal = batchOrdinal(input.reference)
  const parts = [safe(input.workspaceSlug), safe(input.prefix), month, ordinal ? String(ordinal) : null]
  return `${parts.filter(Boolean).join("-")}.csv`
}
