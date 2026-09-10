import type { ErrorResponse } from '@repro/contracts';

/** Error codes from docs/API.md. Every client-visible error uses one of these. */
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'payload_too_large'
  | 'unsupported_encoding'
  | 'rate_limited'
  | 'conflict'
  | 'internal';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  payload_too_large: 413,
  unsupported_encoding: 415,
  rate_limited: 429,
  conflict: 409,
  internal: 500,
};

/**
 * The one error type routes and services throw. The error handler turns it into the
 * API.md error shape; anything else that reaches the handler becomes a generic `internal`.
 */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = STATUS_BY_CODE[code];
  }

  toResponse(): ErrorResponse {
    const error: ErrorResponse['error'] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { ok: false, error };
  }
}

export const notFound = (what: string): AppError => new AppError('not_found', `${what} not found`);
export const unauthorized = (message: string): AppError => new AppError('unauthorized', message);
export const forbidden = (message: string): AppError => new AppError('forbidden', message);
export const validationFailed = (message: string, details?: unknown): AppError =>
  new AppError('validation_failed', message, details);
