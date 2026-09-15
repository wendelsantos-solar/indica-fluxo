/**
 * Program form limits shared by the Zod schema and the form's inputs. A module
 * of its own so the client form does not pull Zod into the browser bundle.
 */

export const WEBSITE_URL_MAX_LENGTH = 2048

/**
 * `commission_duration_months = 1` is exactly "first payment only", so "for a
 * number of months" starts at 2. Otherwise a program saved as "1 month" would
 * reopen as "first payment only" (UI_UX_FUNCTIONAL_FINDINGS D6).
 */
export const DURATION_MONTHS_MIN = 2
export const DURATION_MONTHS_MAX = 120
