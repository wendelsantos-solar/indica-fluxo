/**
 * Seed scripts run under plain Node (tsx), not under Next.js, so the
 * environment has to be loaded explicitly before anything reads it.
 *
 * Import this module FIRST in every seed entrypoint.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

/**
 * Seeding writes demo rows with the RLS-bypassing service connection and
 * provisions logins with a fixed, publicly documented password. That is
 * acceptable on a development database and unacceptable anywhere else.
 */
export function assertNotProduction(command: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Refusing to run \`${command}\` with NODE_ENV=production. ` +
        "Seed and demo data belong to development databases only.",
    )
  }
}

export function describeTarget(): string {
  const url = process.env.DATABASE_URL ?? ""
  // Host only — a connection string carries a password.
  const host = url.match(/@([^/:]+)/)?.[1] ?? "unknown host"
  return host
}
