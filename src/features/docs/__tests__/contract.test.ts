import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import en from "@/i18n/messages/en.json"
import ptBr from "@/i18n/messages/pt-br.json"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { commissionStatusEnum } from "@/server/db/schema/enums"
import { programFormSchema } from "@/features/programs/schema"

import { DOCS_GROUPS } from "../structure"

/**
 * The guide is a contract, so the facts it states have to be the ones the code
 * enforces. `snippets.test.ts` pins the code samples; this file pins the rest:
 * the error codes each route can answer, the program limits, the commission
 * states, the anchors and the two catalogues against each other. A change on
 * either side fails here instead of drifting into the public docs
 * (DOCS_IMPLEMENTATION_AUDIT.md, "Preventing drift").
 */

const ROOT = join(__dirname, "../../../..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

const docsPage = read("src/app/[locale]/(docs)/docs/page.tsx")

/** The `ERROR_GROUPS` table the guide renders, parsed out of the page. */
function documentedCodes(group: string): [string, number][] {
  const table = docsPage.slice(docsPage.indexOf("const ERROR_GROUPS"), docsPage.indexOf("RESPONSE_LABEL"))
  const block = table.slice(table.indexOf(`key: "${group}"`))
  const rows = block.slice(0, block.indexOf("],\n  }")).matchAll(/\["([A-Za-z_]+)",\s*(\d{3})\]/g)
  return [...rows].map(([, code, status]) => [code, Number(status)])
}

describe("documented error codes exist in the route that answers them", () => {
  const sources = {
    identify: read("src/app/api/identify/route.ts") + read("src/server/policies/errors.ts"),
    track: read("src/app/api/track/route.ts") + read("src/server/services/tracking.ts") + read("src/server/policies/errors.ts"),
    webhook:
      read("src/app/api/webhooks/stripe/[integrationId]/route.ts") +
      read("src/app/api/webhooks/stripe/responses.ts"),
  } as const

  for (const group of ["identify", "track", "webhook"] as const) {
    it(`${group}: every code in the guide is written by the code`, () => {
      const codes = documentedCodes(group)
      expect(codes.length).toBeGreaterThan(0)
      for (const [code, status] of codes) {
        // 200 is the implicit default of `NextResponse.json`, so only the
        // explicit statuses appear as literals in the route.
        if (status !== 200) expect(sources[group], `${group}.${code} status`).toContain(String(status))
        // `no_content` is the table's label for the empty 204; the route has no
        // such string. Everything else is a literal the source must contain.
        if (code === "no_content") continue
        expect(sources[group], `${group}.${code}`).toContain(code)
      }
    })

    it(`${group}: the guide has a row for every documented code, in both catalogues`, () => {
      for (const [code] of documentedCodes(group)) {
        for (const [locale, messages] of [["pt-br", ptBr], ["en", en]] as const) {
          const item = (messages.docs.errors.groups as Record<string, { items: Record<string, unknown> }>)[group].items[
            code
          ]
          expect(item, `${locale}: errors.groups.${group}.items.${code}`).toBeDefined()
        }
      }
    })
  }
})

describe("program limits", () => {
  const dbChecks = read("src/server/db/schema/programs.ts")
  /** A program the form would accept, minus the field each case varies. */
  const PROGRAM_FORM = {
    workspaceSlug: "acme",
    name: "Programa",
    status: "active",
    commissionType: "percentage",
    commissionAmount: "10",
    recurrence: "lifetime",
    attributionModel: "last_click",
    attributionWindowDays: "60",
    commissionHoldDays: "30",
    currency: "BRL",
  }

  it("the attribution window is 1–365 in the DB and in the form schema", () => {
    expect(dbChecks).toContain("between 1 and 365")
    const base = { ...PROGRAM_FORM, commissionHoldDays: "30" }
    expect(programFormSchema.safeParse({ ...base, attributionWindowDays: "365" }).success).toBe(true)
    expect(programFormSchema.safeParse({ ...base, attributionWindowDays: "366" }).success).toBe(false)
    expect(programFormSchema.safeParse({ ...base, attributionWindowDays: "0" }).success).toBe(false)
  })

  it("the hold period is 0–180 in the DB and in the form schema", () => {
    expect(dbChecks).toContain("between 0 and 180")
    const base = { ...PROGRAM_FORM, attributionWindowDays: "60" }
    expect(programFormSchema.safeParse({ ...base, commissionHoldDays: "0" }).success).toBe(true)
    expect(programFormSchema.safeParse({ ...base, commissionHoldDays: "180" }).success).toBe(true)
    expect(programFormSchema.safeParse({ ...base, commissionHoldDays: "181" }).success).toBe(false)
  })
})

describe("commission states", () => {
  /** Rendered by the guide's lifecycle list (`docs/page.tsx`). */
  const documented = ["pending", "available", "approved", "paid", "reversed"] as const

  it("every state the guide names exists in the enum", () => {
    for (const state of documented) expect(commissionStatusEnum.enumValues).toContain(state)
  })

  it("the guide and the dashboard use the same label for each state", () => {
    for (const [locale, messages] of [["pt-br", ptBr], ["en", en]] as const) {
      for (const state of documented) {
        const guide = (messages.docs.commission.states as Record<string, string>)[state]
        const dashboard = (messages.dashboard.commissions.statusLabel as Record<string, string>)[state]
        expect(guide, `${locale}.${state}`).toBe(dashboard)
      }
    }
  })

  it("`rejected` is still unreachable, so the guide must not promise it", () => {
    // DOCS_IMPLEMENTATION_AUDIT.md D7: the enum value exists and is labelled,
    // but no service writes it. If a "reject commission" action ships, document
    // the state and update this test.
    expect(commissionStatusEnum.enumValues).toContain("rejected")
    expect(Object.keys(ptBr.docs.commission.states)).not.toContain("rejected")
    expect(read("src/server/services/payouts.ts")).not.toContain('"rejected"')
  })
})

describe("outline", () => {
  const sections = DOCS_GROUPS.flatMap((group) => group.sections)
  const all = sections.flatMap((section) => [section, ...(section.children ?? [])])

  it("anchors are unique per locale", () => {
    for (const locale of ["pt-br", "en"] as const) {
      const anchors = all.map((item) => item.anchors[locale])
      expect(new Set(anchors).size, locale).toBe(anchors.length)
    }
  })

  it("every anchor is rendered as a heading id on the page", () => {
    for (const item of all) {
      // Most headings call `anchor("key")`; the two attribution models are
      // rendered from a list, so the key appears as a literal in that map.
      expect(
        docsPage.includes(`anchor("${item.key}")`) || docsPage.includes(`"${item.key}"`),
        item.key,
      ).toBe(true)
    }
  })

  it("every section and subsection is named in both catalogues", () => {
    for (const [locale, messages] of [["pt-br", ptBr], ["en", en]] as const) {
      for (const section of sections) {
        expect((messages.docs.nav.sections as Record<string, string>)[section.key], `${locale}.${section.key}`).toBeTruthy()
        for (const child of section.children ?? []) {
          expect((messages.docs.nav.subsections as Record<string, string>)[child.key], `${locale}.${child.key}`).toBeTruthy()
        }
      }
    }
  })
})

describe("catalogue parity", () => {
  function flatten(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) return [prefix]
    return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
  }

  it("pt-br and en carry the same docs keys", () => {
    expect(flatten(en.docs).sort()).toEqual(flatten(ptBr.docs).sort())
  })

  it("pt-br and en use the same rich-text tags in each string", () => {
    const tags = (text: string) => [...text.matchAll(/<([a-z]+)>/g)].map(([, tag]) => tag).sort()
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === "string" && typeof b === "string") {
        expect(tags(a), path).toEqual(tags(b))
        return
      }
      if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return
      for (const key of Object.keys(a)) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`)
      }
    }
    walk(ptBr.docs, en.docs, "docs")
  })
})

/**
 * A Stripe event whose `records` key has no label renders `MISSING_MESSAGE` on
 * the public guide — which is how `checkout.session.completed` first shipped,
 * caught in a browser rather than here. Every handled event now has to name
 * itself in both catalogues.
 */
describe("Stripe events table", () => {
  it("labels every handled event's outcome in both catalogues", () => {
    for (const [locale, messages] of [
      ["pt-br", ptBr],
      ["en", en],
    ] as const) {
      for (const event of STRIPE_HANDLED_EVENTS) {
        const types = messages.docs.webhookEvents.types as Record<string, string>
        expect(types[event.records], `${locale}.docs.webhookEvents.types.${event.records}`).toBeTruthy()
      }
    }
  })
})
