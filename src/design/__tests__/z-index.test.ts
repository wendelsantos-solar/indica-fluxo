import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..", "..")
const THEME = readFileSync(join(__dirname, "..", "theme.css"), "utf8")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry) ? [path] : []
  })
}

/** Tokens in stacking order, lowest first — DESIGN.md §6 "Stacking". */
const ORDER = ["base", "raised", "sticky", "header", "drawer", "modal", "popover", "toast", "skip"]

describe("z-index scale", () => {
  it("defines every layer once, in ascending order", () => {
    const values = ORDER.map((name) => {
      const match = THEME.match(new RegExp(`--z-index-${name}:\\s*(-?\\d+);`))
      expect(match, `--z-index-${name}`).not.toBeNull()
      return Number(match![1])
    })
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(values).size).toBe(values.length)
  })

  it("puts floating layers above the drawer and the modal that open them", () => {
    const value = (name: string) => Number(THEME.match(new RegExp(`--z-index-${name}:\\s*(\\d+);`))![1])
    expect(value("popover")).toBeGreaterThan(value("drawer"))
    expect(value("popover")).toBeGreaterThan(value("modal"))
  })

  it("leaves no arbitrary z-index values in the source", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /(^|[\s"'`:])-?z-\[/.test(line))
        .map(({ index }) => `${relative(SRC, file)}:${index + 1}`),
    )
    expect(offenders).toEqual([])
  })
})
