import "server-only"

import { type Column, sql, type SQL } from "drizzle-orm"

/**
 * Table-qualified reference to a column, for use inside a `sql` template.
 *
 * When a select has no join, Drizzle's `buildSelection` rewrites every column
 * appearing in an `sql` field to a bare identifier — `"programs"."id"` becomes
 * `"id"` (pg-core/dialect.ts, `isSingleTable`). That is harmless in the outer
 * select, and wrong in a sub-query, where Postgres resolves the bare name
 * against the sub-query's own FROM. It breaks two ways:
 *
 *   - Correlation is silently lost.  `where ${referralClicks.programId} =
 *     ${programs.id}` becomes `where program_id = "id"`, comparing
 *     referral_clicks to itself. No error; the aggregate just returns 0.
 *   - Or it fails loudly with 42702, when a join inside the sub-query puts the
 *     same bare column name in scope twice.
 *
 * The rewrite only walks top-level chunks, so wrapping the column in a nested
 * `SQL` carries the table qualifier through untouched.
 *
 * A select that already joins is unaffected — Drizzle qualifies everything
 * there, and this helper is redundant.
 */
export function qualified(column: Column): SQL {
  return sql`${column}`
}
