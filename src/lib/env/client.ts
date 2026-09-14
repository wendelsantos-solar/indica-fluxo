import { z } from "zod"

/**
 * The only environment values that may reach the browser bundle.
 *
 * This module is importable from Client Components and from the edge runtime.
 * It must never read — or re-export — a server-only secret.
 */

/**
 * Supabase's new key model prefixes browser-safe keys with `sb_publishable_`
 * and server-only keys with `sb_secret_`. A `sb_secret_*` value reaching any
 * `NEXT_PUBLIC_*` variable would be inlined into the client bundle, so it is
 * rejected at parse time rather than shipped.
 */
const publishableKey = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("sb_secret_"), {
    message:
      "A Supabase secret key (sb_secret_*) was assigned to a NEXT_PUBLIC_ variable. " +
      "Use the publishable key (sb_publishable_*) here and rotate the leaked secret.",
  })

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  NEXT_PUBLIC_APP_URL: z.string().url(),
})

export type ClientEnv = z.infer<typeof clientSchema>

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so each name must
 * appear as a literal member expression. Reading them here is free; validation
 * is deferred so that `next build` can collect page data without a configured
 * environment, exactly as `@/lib/env/server` does.
 */
const raw = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
}

let cached: ClientEnv | null = null

export function clientEnv(): ClientEnv {
  if (cached) return cached

  const parsed = clientSchema.safeParse(raw)
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")
    throw new Error(
      `Invalid public environment. Check these variables against .env.example: ${missing}`,
    )
  }

  cached = parsed.data
  return cached
}
