import type { IndexableHref } from "@/lib/seo/pages"

/**
 * The shape of each search-intent page. The words live in the catalogues under
 * `seo.pages.<key>`; this file only says which sections exist, in what order,
 * and what kind of block each one carries, so the renderer never guesses at a
 * key and the catalogue-parity test catches a missing translation.
 *
 * Section keys double as the in-page anchors (`#tracking`), which is why they
 * are short, stable and not translated.
 */

export type ContentBlock =
  /** `p1`…`pN` rich paragraphs. */
  | { kind: "prose"; paragraphs: number }
  /** A grid of `points.<key>.title` / `.body`. */
  | { kind: "points"; items: readonly string[] }
  /** An ordered list of `steps.<key>.title` / `.body`. */
  | { kind: "steps"; items: readonly string[] }
  /** `table.columns.<col>` headings and `table.rows.<row>.<col>` cells; the first column heads each row. */
  | { kind: "table"; columns: readonly string[]; rows: readonly string[] }
  /** A single closing paragraph, `note`. */
  | { kind: "note" }

export interface ContentSection {
  key: string
  blocks: readonly ContentBlock[]
}

export type ContentPageKey = "saasAffiliateProgram" | "affiliateSoftware" | "stripeAffiliates"

export interface ContentPage {
  key: ContentPageKey
  href: Extract<IndexableHref, "/saas-affiliate-program" | "/affiliate-software" | "/stripe-affiliates">
  /** Where the second hero button leads. The first is always sign-up. */
  secondary: IndexableHref
  sections: readonly ContentSection[]
  faq: readonly string[]
  /** "Keep reading": the neighbouring intents, then pricing or docs. Never the page itself. */
  related: readonly IndexableHref[]
}

export const CONTENT_PAGES: Record<ContentPageKey, ContentPage> = {
  saasAffiliateProgram: {
    key: "saasAffiliateProgram",
    href: "/saas-affiliate-program",
    secondary: "/stripe-affiliates",
    sections: [
      { key: "what", blocks: [{ kind: "prose", paragraphs: 2 }] },
      {
        key: "when",
        blocks: [
          { kind: "prose", paragraphs: 1 },
          { kind: "points", items: ["recurring", "partners", "selfServe", "results"] },
          { kind: "note" },
        ],
      },
      { key: "tracking", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "attribution", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "recurring", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "refunds", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "stripe", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "portal", blocks: [{ kind: "prose", paragraphs: 1 }] },
      { key: "payouts", blocks: [{ kind: "prose", paragraphs: 2 }] },
      {
        key: "start",
        blocks: [{ kind: "steps", items: ["create", "simulate", "install", "connect", "invite"] }, { kind: "note" }],
      },
    ],
    faq: ["marketplace", "rate", "developer", "money", "fee"],
    related: ["/affiliate-software", "/stripe-affiliates", "/pricing"],
  },

  affiliateSoftware: {
    key: "affiliateSoftware",
    href: "/affiliate-software",
    secondary: "/pricing",
    sections: [
      {
        key: "options",
        blocks: [
          {
            kind: "table",
            columns: ["task", "spreadsheet", "inHouse", "software"],
            rows: ["tracking", "attribution", "recurring", "refunds", "duplicates", "portal", "cost"],
          },
        ],
      },
      { key: "spreadsheet", blocks: [{ kind: "prose", paragraphs: 1 }] },
      { key: "inHouse", blocks: [{ kind: "prose", paragraphs: 2 }] },
      {
        key: "criteria",
        blocks: [{ kind: "points", items: ["tracking", "recurring", "reversals", "ledger", "pricing", "test"] }],
      },
      {
        key: "product",
        blocks: [
          { kind: "prose", paragraphs: 1 },
          { kind: "points", items: ["rules", "environments", "portal", "payouts", "privacy", "custody"] },
        ],
      },
      { key: "pricingModel", blocks: [{ kind: "prose", paragraphs: 1 }] },
    ],
    faq: ["checkout", "withoutStripe", "limits", "trial"],
    related: ["/saas-affiliate-program", "/stripe-affiliates", "/pricing"],
  },

  stripeAffiliates: {
    key: "stripeAffiliates",
    href: "/stripe-affiliates",
    secondary: "/docs",
    sections: [
      { key: "flow", blocks: [{ kind: "steps", items: ["click", "checkout", "webhook", "commission"] }] },
      {
        key: "methods",
        blocks: [
          {
            kind: "table",
            columns: ["method", "setup"],
            rows: ["checkout", "paymentLinks", "custom", "subscriptions", "other"],
          },
          { kind: "note" },
        ],
      },
      { key: "recurring", blocks: [{ kind: "prose", paragraphs: 2 }] },
      { key: "refunds", blocks: [{ kind: "prose", paragraphs: 1 }] },
      { key: "security", blocks: [{ kind: "prose", paragraphs: 1 }] },
      { key: "testMode", blocks: [{ kind: "prose", paragraphs: 1 }] },
    ],
    faq: ["secretKey", "checkout", "events", "payouts"],
    related: ["/saas-affiliate-program", "/affiliate-software", "/docs"],
  },
}

/** The catalogue key of each page's "keep reading" card (`seo.links.<key>`). */
export const LINK_CARD_KEY: Partial<Record<IndexableHref, string>> = {
  "/saas-affiliate-program": "saasAffiliateProgram",
  "/affiliate-software": "affiliateSoftware",
  "/stripe-affiliates": "stripeAffiliates",
  "/pricing": "pricing",
  "/docs": "docs",
}
