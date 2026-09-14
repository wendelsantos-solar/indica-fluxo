import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { routing } from "../routing"

/**
 * Catalogue parity, as a test rather than as discipline.
 *
 * A missing key does not crash: next-intl renders the key path instead, so an
 * untranslated string ships looking like `dashboard.commissions.title` and
 * nobody notices until a customer does. These assertions make the build notice.
 */

const DIR = join(process.cwd(), "src/i18n/messages")

type Catalogue = Record<string, unknown>

function load(locale: string): Catalogue {
  return JSON.parse(readFileSync(join(DIR, `${locale}.json`), "utf8"))
}

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix]
  return Object.entries(value as Catalogue).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

const locales = routing.locales

describe("message catalogues", () => {
  it("ships one catalogue per configured locale, and no orphans", () => {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort()

    expect(files).toEqual([...locales].sort())
  })

  it("defines exactly the same keys in every locale", () => {
    const [reference, ...rest] = locales
    const expected = keyPaths(load(reference!)).sort()

    for (const locale of rest) {
      const actual = keyPaths(load(locale)).sort()

      const missing = expected.filter((key) => !actual.includes(key))
      const extra = actual.filter((key) => !expected.includes(key))

      expect(missing, `${locale} is missing keys present in ${reference}`).toEqual([])
      expect(extra, `${locale} has keys absent from ${reference}`).toEqual([])
    }
  })

  it("has no empty strings, which render as a blank element", () => {
    for (const locale of locales) {
      const catalogue = load(locale)
      const blanks = keyPaths(catalogue).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Catalogue)?.[key], catalogue)
        return typeof value === "string" && value.trim() === ""
      })
      expect(blanks, `${locale} has blank messages`).toEqual([])
    }
  })

  /**
   * An untranslated string is easy to miss because it still reads correctly to
   * an English speaker. Identical values are legitimate for proper nouns and
   * product names, so this only reports the ratio rather than failing — it is a
   * canary for a catalogue that was copied and never translated.
   */
  it("does not consist mostly of untranslated copies", () => {
    const pt = load("pt-br")
    const en = load("en")

    const paths = keyPaths(pt)
    const read = (c: Catalogue, path: string) =>
      path.split(".").reduce<unknown>((node, key) => (node as Catalogue)?.[key], c)

    const identical = paths.filter((path) => read(pt, path) === read(en, path))

    expect(identical.length / paths.length).toBeLessThan(0.35)
  })
})
