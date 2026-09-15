/**
 * The demo dataset, described declaratively.
 *
 * Seed/demo code lives only under this folder and is never imported by a
 * production code path (CLAUDE.md, "additional standing rules"). Everything
 * here is deterministic: the same command always produces the same numbers,
 * which makes screenshots, tests and bug reports comparable.
 */

export const DEMO_PASSWORD = "demo-password-1234"

/** The demo is a Brazilian SaaS, so its ledger and its console output are pt-BR. */
export const SEED_LOCALE = "pt-br"

/** RFC 2606 reserves example.com, so these addresses can never be real people. */
export const DEMO_EMAIL_DOMAIN = "example.com"

export const DEMO_WORKSPACE = {
  name: "Acme SaaS",
  slug: "acme",
  currency: "BRL",
  timezone: "America/Sao_Paulo",
  plan: "growth",
} as const

export const DEMO_FOUNDER = {
  email: `founder@${DEMO_EMAIL_DOMAIN}`,
  fullName: "Alex Rivera",
} as const

export const DEMO_PROGRAM = {
  name: "Acme Partners",
  slug: "acme-partners",
  description:
    "Indique times para a Acme e ganhe 30% de cada pagamento nos primeiros 12 meses.",
  status: "active",
  commissionType: "percentage",
  /** Basis points: 3000 = 30%. */
  commissionValue: 3000,
  commissionDurationMonths: 12,
  attributionModel: "last_click",
  attributionWindowDays: 60,
  /** Short enough that the demo shows both `pending` and `available` rows. */
  commissionHoldDays: 14,
  currency: "BRL",
} as const

/** Stripe test-mode style account id. Nothing here talks to Stripe. */
export const DEMO_STRIPE_ACCOUNT = "acct_demo_acme"

export interface AffiliateBlueprint {
  code: string
  name: string
  email: string
  companyName: string | null
  country: string
  /** `true` gives this affiliate a real login to the affiliate portal. */
  withLogin: boolean
  participationStatus: "approved" | "pending"
  /** Overrides the program rule. This is the VIP-rate feature. */
  customCommissionValue?: number
  /** Visitors that never convert — the denominator of the funnel. */
  noiseClicks: number
  /** Visitors that go on to pay. */
  conversions: number
  /** Monthly plan price in minor units, cycled through per conversion. */
  plans: number[]
  links: { name: string; path: string; campaign: string | null }[]
}

export const DEMO_AFFILIATES: AffiliateBlueprint[] = [
  {
    code: "wendel",
    name: "Wendel Santos",
    email: `wendel@${DEMO_EMAIL_DOMAIN}`,
    companyName: null,
    country: "BR",
    withLogin: true,
    participationStatus: "approved",
    noiseClicks: 380,
    conversions: 8,
    plans: [9700, 19700],
    links: [
      { name: "Newsletter", path: "/", campaign: "newsletter" },
      { name: "YouTube review", path: "/pricing", campaign: "yt-review" },
    ],
  },
  {
    code: "agencylabs",
    name: "Agency Labs",
    email: `partners@${DEMO_EMAIL_DOMAIN}`,
    companyName: "Agency Labs Ltd.",
    country: "GB",
    withLogin: false,
    participationStatus: "approved",
    /** 40% instead of the program's 30% — negotiated rate. */
    customCommissionValue: 4000,
    noiseClicks: 240,
    conversions: 6,
    plans: [19700, 19700, 9700],
    links: [{ name: "Client onboarding", path: "/", campaign: "clients" }],
  },
  {
    code: "joao",
    name: "João Pereira",
    email: `joao@${DEMO_EMAIL_DOMAIN}`,
    companyName: null,
    country: "PT",
    withLogin: false,
    participationStatus: "approved",
    noiseClicks: 160,
    conversions: 4,
    plans: [9700],
    links: [{ name: "Blog post", path: "/", campaign: "blog" }],
  },
  {
    code: "maria",
    name: "Maria Souza",
    email: `maria@${DEMO_EMAIL_DOMAIN}`,
    companyName: null,
    country: "BR",
    withLogin: false,
    participationStatus: "approved",
    noiseClicks: 95,
    conversions: 3,
    plans: [9700, 19700],
    links: [{ name: "Community", path: "/", campaign: "community" }],
  },
  {
    /** Applied but not approved yet — so the dashboard shows a real pending row. */
    code: "pedro",
    name: "Pedro Lima",
    email: `pedro@${DEMO_EMAIL_DOMAIN}`,
    companyName: "Lima Media",
    country: "BR",
    withLogin: false,
    participationStatus: "pending",
    noiseClicks: 0,
    conversions: 0,
    plans: [9700],
    links: [],
  },
]

export const DEMO_EMAILS = [
  DEMO_FOUNDER.email,
  ...DEMO_AFFILIATES.map((affiliate) => affiliate.email),
]

/** How far back the generated history reaches. */
export const HISTORY_DAYS = 120

export const UTM_SOURCES = ["newsletter", "youtube", "twitter", "blog", "podcast", "direct"]
export const UTM_MEDIUMS = ["email", "social", "referral", "organic"]
export const COUNTRIES = ["BR", "US", "PT", "GB", "DE", "ES", "MX", "CA"]
export const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
]

/**
 * mulberry32 — a tiny deterministic PRNG. Seeded once so every run of
 * `pnpm db:seed` produces byte-identical demo data.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

export function daysAgo(days: number, hourOffset = 0): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(9 + hourOffset, 17, 0, 0)
  return date
}
