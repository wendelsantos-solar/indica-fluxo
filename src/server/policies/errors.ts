/**
 * Domain-level failures that must produce a readable message rather than a
 * stack trace. Anything else is a bug and should surface as a 500.
 *
 * Every failure carries a `messageKey` as well as a message. The message is
 * English and is for logs and for developers; the key is what the UI renders,
 * translated, through the `errors` namespace. Services must not know the
 * reader's language, and an English string baked into a service would be one
 * more thing to find and fix later.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** Catalogue key under `errors.*`. Falls back to the generic message. */
    readonly messageKey: string = "generic",
  ) {
    super(message)
    this.name = "AppError"
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You must be signed in to do that.", messageKey = "unauthorized") {
    super(message, "unauthorized", 401, messageKey)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this workspace.", messageKey = "forbidden") {
    super(message, "forbidden", 403, messageKey)
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.", messageKey = "notFound") {
    super(message, "not_found", 404, messageKey)
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    messageKey = "validation",
  ) {
    super(message, "validation_error", 422, messageKey)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, messageKey = "conflict") {
    super(message, "conflict", 409, messageKey)
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests.", "rate_limited", 429, "rateLimited")
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
