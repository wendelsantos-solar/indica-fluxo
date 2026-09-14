/**
 * Applies every migration in `src/server/db/migrations`, including the
 * handwritten SQL that installs triggers, helper functions and RLS policies.
 */
import { config } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required to run migrations.")

  const client = postgres(url, { max: 1, prepare: false })
  try {
    await migrate(drizzle(client), { migrationsFolder: "./src/server/db/migrations" })
    console.log("Migrations applied.")
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
