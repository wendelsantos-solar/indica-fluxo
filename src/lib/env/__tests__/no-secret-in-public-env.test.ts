import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

/**
 * Supabase's new key model: `sb_publishable_*` is browser-safe, `sb_secret_*`
 * is server-only. Next.js inlines every `NEXT_PUBLIC_*` value into the client
 * bundle, so the two must never meet. These are regression guards, not unit
 * tests — a failure here means a secret is one build away from the browser.
 */

const LEGACY_NAMES = ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, acc)
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      acc.push(path)
    }
  }
  return acc
}

function envFile(name: string): string {
  return readFileSync(join(ROOT, name), "utf8")
}

/**
 * Comments are stripped before scanning: a module documenting that it must
 * never touch the secret key is evidence of the rule, not a breach of it.
 */
function code(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

describe("public environment hygiene", () => {
  it("never assigns a secret key to a NEXT_PUBLIC_ variable", () => {
    for (const name of [".env.example"]) {
      const offending = envFile(name)
        .split("\n")
        .filter((line) => /^NEXT_PUBLIC_/.test(line) && line.includes("sb_secret_"))
      expect(offending, `${name} assigns a secret key to a public variable`).toEqual([])
    }
  })

  it("declares no NEXT_PUBLIC_ variable whose name claims to be a secret", () => {
    const names = [...envFile(".env.example").matchAll(/^(NEXT_PUBLIC_\w+)=/gm)].map(
      (match) => match[1],
    )
    expect(names.filter((name) => /SECRET|SERVICE_ROLE/.test(name))).toEqual([])
  })

  it("has no source file left on the legacy key names", () => {
    const offenders = sourceFiles(join(ROOT, "src")).filter((path) => {
      if (path.endsWith("no-secret-in-public-env.test.ts")) return false
      const contents = readFileSync(path, "utf8")
      return LEGACY_NAMES.some((name) => contents.includes(name))
    })
    expect(offenders).toEqual([])
  })

  it("keeps the secret key out of every module the browser can reach", () => {
    const offenders = sourceFiles(join(ROOT, "src")).filter((path) => {
      if (path.endsWith("no-secret-in-public-env.test.ts")) return false
      const contents = readFileSync(path, "utf8")
      if (!code(contents).includes("SUPABASE_SECRET_KEY")) return false
      // Allowed only in modules that are pinned to the server.
      return !contents.startsWith('import "server-only"')
    })
    expect(offenders).toEqual([])
  })
})
