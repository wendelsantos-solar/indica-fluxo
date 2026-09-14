import { getTranslations } from "next-intl/server"

import { isAppError } from "@/server/policies/errors"

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
