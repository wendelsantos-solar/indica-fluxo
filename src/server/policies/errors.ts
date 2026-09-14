/**
 * Domain-level failures that must produce a readable message rather than a
 * stack trace. Anything else is a bug and should surface as a 500.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "AppError"
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You must be signed in to do that.") {
    super(message, "unauthorized", 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this workspace.") {
    super(message, "forbidden", 403)
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "not_found", 404)
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, "validation_error", 422)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict", 409)
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests.", "rate_limited", 429)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
