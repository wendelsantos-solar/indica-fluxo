import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { CLIENT_MESSAGE_SCOPES, pickMessages, type ClientMessageScope } from "../client-namespaces"

/**
 * Every scope ships only part of the catalogue to the browser (see
 * ../client-namespaces.ts). A `useTranslations` call reading a message its
 * scope does not ship renders the key path instead of the text, so this test
 * walks each scope's import graph and checks every call against what the
 * scope's provider actually receives.
 *
 * Over-approximates on purpose: every reachable file counts, server or client.
 */

const SRC = join(process.cwd(), "src")
const LOCALE_DIR = join(SRC, "app/[locale]")

/** Where each scope's provider sits; everything imported from there is in scope. */
const ENTRIES: Record<ClientMessageScope, string[]> = {
  root: ["layout.tsx", "not-found.tsx", "[...rest]", "app"],
  marketing: ["(marketing)"],
  auth: ["(auth)"],
  docs: ["(docs)"],
  app: ["(dashboard)", "(affiliate)", "onboarding"],
}

type Messages = Parameters<typeof pickMessages>[0]
const catalogue = JSON.parse(readFileSync(join(SRC, "i18n/messages/pt-br.json"), "utf8")) as Messages

function sourceFiles(entry: string): string[] {
  const absolute = join(LOCALE_DIR, entry)
  if (statSync(absolute).isFile()) return [absolute]
  return readdirSync(absolute, { recursive: true })
    .map((name) => join(absolute, String(name)))
    .filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__"))
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return candidate
  }
  return null
}

function reachable(entries: string[]): string[] {
  const seen = new Set<string>()
  const stack = entries.flatMap(sourceFiles)
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']((?:@\/|\.{1,2}\/)[^"']+)["']/g)) {
      const target = resolveImport(file, match[1]!)
      if (target) stack.push(target)
    }
  }
  return [...seen]
}

interface Read {
  file: string
  /** Full dotted path, or the prefix of a template-literal key. */
  path: string
  /** `exact`: one message. `subtree`: the key is computed, so everything below `path` is needed. */
  kind: "exact" | "subtree"
}

function translationReads(file: string): Read[] {
  const source = readFileSync(file, "utf8")
  const reads: Read[] = []
  const declarations = [...source.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*(?:"([^"]*)")?\s*\)/g)]
  for (const [index, declaration] of declarations.entries()) {
    const [text, name, namespace = ""] = declaration
    // A file may declare `t` once per component: each declaration owns the
    // source up to the next declaration of the same name.
    const next = declarations.slice(index + 1).find((later) => later[1] === name)
    const region = source.slice(declaration.index! + text.length, next?.index ?? source.length)
    const join2 = (key: string) => [namespace, key].filter(Boolean).join(".")
    const call = new RegExp(`(?<![.\\w])${name}(?:\\.(?:rich|markup|raw|has))?\\(\\s*(?:"([^"]*)"|\`([^\`]*)\`|([^)\\s,]+))`, "g")
    for (const [, literal, template, other] of region.matchAll(call)) {
      if (literal !== undefined) reads.push({ file, path: join2(literal), kind: "exact" })
      else if (template !== undefined && !template.includes("${")) reads.push({ file, path: join2(template), kind: "exact" })
      else if (template !== undefined) {
        const prefix = template.split("${")[0]!.replace(/\.$/, "")
        reads.push({ file, path: join2(prefix), kind: "subtree" })
      } else if (other !== undefined) reads.push({ file, path: namespace, kind: "subtree" })
    }
    // A bare reference (`helper(t)`, `{ t }`) lets the translator escape: its keys are unknown.
    if (new RegExp(`(?<![.\\w-])${name}(?![\\w(.:-])`).test(region)) reads.push({ file, path: namespace, kind: "subtree" })
  }
  return reads
}

describe("client message scopes", () => {
  it("only name paths that exist in the catalogue", () => {
    for (const [scope, paths] of Object.entries(CLIENT_MESSAGE_SCOPES)) {
      for (const path of paths) {
        const found = path.split(".").reduce<unknown>((node, key) => (node as Messages | undefined)?.[key], catalogue)
        expect(found, `${scope}: "${path}" is not in the catalogue`).toBeDefined()
      }
    }
  })

  for (const scope of Object.keys(ENTRIES) as ClientMessageScope[]) {
    it(`ships every message the ${scope} scope reads`, () => {
      const shipped = CLIENT_MESSAGE_SCOPES[scope]
      const picked = pickMessages(catalogue, shipped)
      const lookup = (path: string) =>
        path.split(".").reduce<unknown>((node, key) => (node as Messages | undefined)?.[key], picked)
      const wholeSubtree = (path: string) =>
        shipped.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))

      const missing = reachable(ENTRIES[scope])
        .flatMap(translationReads)
        .filter((read) =>
          read.kind === "exact" ? lookup(read.path) === undefined && !wholeSubtree(read.path) : !wholeSubtree(read.path),
        )
        .map((read) => `${relative(SRC, read.file)} → ${read.path}${read.kind === "subtree" ? ".*" : ""}`)

      expect([...new Set(missing)].sort()).toEqual([])
    })
  }
})
