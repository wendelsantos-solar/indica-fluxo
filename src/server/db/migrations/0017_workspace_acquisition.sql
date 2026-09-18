-- First-touch acquisition of the founder who created the workspace
-- (src/lib/seo/acquisition.ts, SEO_STRATEGY.md §7).
--
-- One nullable column, no rewrite: every existing workspace keeps NULL, which
-- reads as "unknown", never as "direct". Written once, by `createWorkspace`,
-- from the first-party `_acq` cookie the proxy set on the visitor's first page
-- view. It holds a channel, a landing path, a referring HOST and UTM values —
-- no identifier, no full URL, no personal data (DATABASE.md §7).
--
-- No new grant: `indica_app` already has `workspaces` (0009), and the column is
-- covered by the table's existing RLS (members read their own workspace).
ALTER TABLE "workspaces" ADD COLUMN "acquisition" jsonb;
--> statement-breakpoint
-- The funnel report groups by channel and landing page; a partial expression
-- index keeps that cheap without indexing the (majority) NULL rows.
CREATE INDEX "workspaces_acquisition_channel_idx"
  ON "workspaces" USING btree ((acquisition ->> 'channel'), created_at)
  WHERE acquisition IS NOT NULL;
