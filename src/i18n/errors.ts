import { getTranslations } from "next-intl/server"
import type { z } from "zod"

import { describeIssue } from "@/i18n/zod-issues"
import { PLAN_CODES, PLAN_FEATURES, PLAN_LIMITS, type PlanCode, type PlanFeature, type PlanLimit } from "@/lib/plans"

import {
  FeatureNotAvailableError,
  isAppError,
  LiveModeRequiredError,
  PlanLimitReachedError,
} from "@/server/policies/errors"

/**
 * Turns a thrown domain error into a sentence in the reader's language.
 *
 * Services throw `AppError`s carrying a `messageKey`; this is the only place
 * that key becomes words. A failure the domain did not anticipate falls back to
 * the caller's own key rather than leaking an exception message into the UI.
 */
export async function actionError(error: unknown, fallbackKey: string): Promise<string> {
  const t = await getTranslations("errors")
  const key = isAppError(error) ? error.messageKey : fallbackKey
  return t.has(key) ? t(key) : t(fallbackKey)
}

/**
 * What a plan refusal needs to become an upgrade prompt: which limit or
 * feature was in the way and the cheapest plan that fixes it. Plain data, so
 * it travels in a server action's result to the client form.
 */
export interface PlanUpgradeHint {
  code: "PLAN_LIMIT_REACHED" | "FEATURE_NOT_AVAILABLE" | "LIVE_MODE_REQUIRED"
  reason: PlanLimit | PlanFeature
  /** From the error (`upgradeTo`); `null` when no purchasable plan helps. */
  upgradeTo: PlanCode | null
}

function asPlanCode(value: string | null): PlanCode | null {
  return value !== null && (PLAN_CODES as readonly string[]).includes(value) ? (value as PlanCode) : null
}

/** The upgrade hint carried by a plan error, or `undefined` for any other failure. */
export function planUpgradeHint(error: unknown): PlanUpgradeHint | undefined {
  if (error instanceof PlanLimitReachedError && (PLAN_LIMITS as readonly string[]).includes(error.limit)) {
    return { code: "PLAN_LIMIT_REACHED", reason: error.limit as PlanLimit, upgradeTo: asPlanCode(error.upgradeTo) }
  }
  if (error instanceof FeatureNotAvailableError && (PLAN_FEATURES as readonly string[]).includes(error.feature)) {
    return {
      code: "FEATURE_NOT_AVAILABLE",
      reason: error.feature as PlanFeature,
      upgradeTo: asPlanCode(error.upgradeTo),
    }
  }
  if (error instanceof LiveModeRequiredError) {
    return { code: "LIVE_MODE_REQUIRED", reason: "liveMode", upgradeTo: null }
  }
  return undefined
}

/**
 * `actionError` plus the plan hint, for an action state shaped
 * `{ error?: string; upgrade?: PlanUpgradeHint }`. A form renders it with
 * `ActionErrorAlert` (`@/features/plans/action-error-alert`), which shows the
 * upgrade prompt for plan refusals and the plain error otherwise.
 *
 *   } catch (error) {
 *     return actionFailure(error, "programNotCreated")
 *   }
 */
export async function actionFailure(
  error: unknown,
  fallbackKey: string,
): Promise<{ error: string; upgrade?: PlanUpgradeHint }> {
  const message = await actionError(error, fallbackKey)
  const upgrade = planUpgradeHint(error)
  return upgrade ? { error: message, upgrade } : { error: message }
}

/**
 * Zod messages are catalogue keys, not sentences — a schema is shared by every
 * locale and cannot know which one is reading. This translates them at the
 * boundary, on the way back to the form.
 *
 * A message that is not a known key is passed through unchanged, so Zod's own
 * built-in messages (type coercion, min/max on numbers) still surface rather
 * than disappearing.
 */
export async function translateFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Promise<Record<string, string[]>> {
  const t = await getTranslations("errors.fields")
  const out: Record<string, string[]> = {}

  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!messages) continue
    out[field] = messages.map((message) => (t.has(message) ? t(message) : message))
  }

  return out
}

/** The counterpart for the confirmations an action returns on success. */
export async function successMessage(key: string): Promise<string> {
  const t = await getTranslations("success")
  return t(key)
}

/**
 * Field errors for a failed `safeParse`, every one a sentence in the reader's
 * language. A message the schema set as a catalogue key is used as is; Zod's
 * own built-in messages are replaced by `errors.fields.generic.*` from the
 * issue's structured data. Use this instead of flattening by hand.
 */
export async function fieldErrorsFrom(error: z.ZodError): Promise<Record<string, string[]>> {
  const fields = await getTranslations("errors.fields")
  const out: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_form")
    let message: string
    if (fields.has(issue.message)) {
      message = fields(issue.message)
    } else {
      const { key, values } = describeIssue(issue)
      message = fields(`generic.${key}`, values)
    }
    ;(out[field] ??= []).push(message)
  }

  return out
}
