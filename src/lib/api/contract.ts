import { z } from "zod"

/**
 * The public contract of the ingest API (`POST /api/identify`, `POST /api/track`). Shared by the Route Handler and
 * the integration guide, so the documented example is checked against the
 * schema the server actually enforces (`src/features/docs/__tests__/snippets.test.ts`).
 */
export const identifyBodySchema = z.object({
  visitorId: z.string().min(4).max(64),
  externalId: z.string().min(1).max(200),
  providerCustomerId: z.string().max(200).nullish(),
  provider: z.enum(["stripe", "paddle", "manual"]).optional(),
  email: z.string().email().max(320).nullish(),
})

export type IdentifyBody = z.infer<typeof identifyBodySchema>

/** Requests per minute per IP, enforced in the route. */
export const IDENTIFY_RATE_LIMIT = 120
export const TRACK_RATE_LIMIT = 60
