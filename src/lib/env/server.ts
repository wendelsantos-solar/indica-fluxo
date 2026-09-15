import "server-only"

import { z } from "zod"

/**
 * Server-side environment. Parsed lazily so that `next build` does not require
 * production secrets to be present, but any code path that actually reads a
 * secret fails loudly and early.
 *
 * `server-only` is the boundary: nothing here may be imported by a Client
 * Component, so no value in this schema can be inlined into the browser bundle.
 * Public values live in `@/lib/env/client` and are not duplicated here.
 */
/**
 * `.env` files spell "not configured" as `FOO=""`, but an empty string is a
 * present value to Zod, so a bare `.optional()` would reject it and take every
 * server render down with it. Treat empty as absent.
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional())
}

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),

  /**
   * Supabase `sb_secret_*` key. BYPASSES RLS — only `@/lib/supabase/admin` may
   * read it. Optional because the session-scoped clients (browser/server) do
   * not need it; `requireSupabaseSecretKey()` demands it at the point of use instead.
   */
  SUPABASE_SECRET_KEY: optional(
    z
      .string()
      .min(1)
      .refine((value) => !value.startsWith("sb_publishable_"), {
        message:
          "SUPABASE_SECRET_KEY holds a publishable key (sb_publishable_*). " +
          "The admin client requires the secret key (sb_secret_*).",
      }),
  ),

  /** 32-byte key, base64 encoded. Used for AES-256-GCM at-rest encryption. */
  ENCRYPTION_KEY: z.string().min(32),
  /** Pepper for one-way hashes (api keys, emails, ip addresses). */
  HASH_PEPPER: z.string().min(16),

  STRIPE_SECRET_KEY: optional(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: optional(z.string().min(1)),
  STRIPE_CONNECT_CLIENT_ID: optional(z.string().min(1)),

  /**
   * Platform billing — IndicaFluxo's OWN Stripe account, charging workspaces
   * for Launch/Growth (docs/PLANS.md §5). Never the founders' Stripe above.
   * Optional as a set: without all four, checkout is unavailable and Settings
   * falls back to the manual upgrade request. See `platformBillingEnv()`.
   */
  PLATFORM_STRIPE_SECRET_KEY: optional(z.string().min(1)),
  PLATFORM_STRIPE_WEBHOOK_SECRET: optional(z.string().min(1)),
  STRIPE_LAUNCH_PRICE_ID: optional(z.string().min(1)),
  STRIPE_GROWTH_PRICE_ID: optional(z.string().min(1)),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | null = null

export function env(): ServerEnv {
  if (cached) return cached

  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ")
    throw new Error(
      `Invalid server environment. Check these variables against .env.example: ${missing}`,
    )
  }

  cached = parsed.data
  return cached
}

/**
 * Narrow accessor for the RLS-bypassing key, so that forgetting to configure it
 * fails at the admin call site rather than breaking every server render.
 */
export function requireSupabaseSecretKey(): string {
  const key = env().SUPABASE_SECRET_KEY
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required only by the Supabase admin client.",
    )
  }
  return key
}

export interface PlatformBillingEnv {
  secretKey: string
  webhookSecret: string
  launchPriceId: string
  growthPriceId: string
}

/** The platform-billing settings, or `null` unless all four are present. */
export function platformBillingEnv(): PlatformBillingEnv | null {
  const {
    PLATFORM_STRIPE_SECRET_KEY: secretKey,
    PLATFORM_STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_LAUNCH_PRICE_ID: launchPriceId,
    STRIPE_GROWTH_PRICE_ID: growthPriceId,
  } = env()
  if (!secretKey || !webhookSecret || !launchPriceId || !growthPriceId) return null
  return { secretKey, webhookSecret, launchPriceId, growthPriceId }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}
