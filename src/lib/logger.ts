/**
 * Structured logging. Single-line JSON in production, readable in development.
 * Never log secrets: values under redacted keys, and anything key-shaped, are
 * scrubbed at any depth before serialisation. See CLAUDE.md.
 */

type Level = "debug" | "info" | "warn" | "error"

export interface LogContext {
  requestId?: string
  workspaceId?: string
  provider?: string
  eventId?: string
  [key: string]: unknown
}

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "apikey",
  "api_key",
  "key",
  "keyhash",
  "key_hash",
  "encrypted_credentials",
  "encryptedcredentials",
  "email",
  "stripe-signature",
  "x-signature",
  "x-webhook-signature",
  "asaas-access-token",
  "webhooksecret",
  "authtoken",
  "accesstoken",
])

// Stripe (sk_/pk_/rk_/whsec_), JWTs (ey…), Mercado Pago access tokens
// (APP_USR-/TEST-), Asaas ($aact_…) and AbacatePay (abc_prod_/abc_dev_) keys.
const SECRET_PATTERN = /(\b(sk|pk|rk|whsec|ey[A-Za-z0-9])|\bAPP_USR|\bTEST-|\$aact|\babc_(?:prod|dev))[-_A-Za-z0-9]{8,}/g

function scrubString(value: string): string {
  return value.replace(SECRET_PATTERN, "[redacted]")
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrub(v, depth + 1)
    }
    return out
  }
  return "[unserialisable]"
}

function emit(level: Level, message: string, context?: LogContext): void {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? (scrub(context) as Record<string, unknown>) : {}),
  }

  const sink = console[level === "debug" ? "log" : level]

  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify(payload))
    return
  }

  const rest = { ...payload } as Record<string, unknown>
  delete rest.level
  delete rest.timestamp
  delete rest.message

  sink(
    `${level.toUpperCase().padEnd(5)} ${message}`,
    Object.keys(rest).length > 0 ? rest : "",
  )
}

export const logger = {
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV !== "production") emit("debug", message, context)
  },
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => logger.debug(m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => logger.info(m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => logger.warn(m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => logger.error(m, { ...base, ...c }),
    }
  },
}
