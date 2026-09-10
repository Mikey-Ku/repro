/**
 * Uncaught exceptions and unhandled promise rejections. Only strings derived from the error
 * are kept (name, message, stack); the error object itself is never stored or referenced.
 */
import { sanitizeUrl, truncate, LIMITS } from '@repro/contracts/runtime';
import type { ErrorEvent as ReproErrorEvent } from '@repro/contracts';
import { safeStringify, scrubAndTruncate } from '../redact.js';
import type { CaptureContext, Stop } from '../types.js';

export interface ErrorFields {
  name?: string;
  message: string;
  stack?: string;
}

/** Pull printable fields out of anything that was thrown or rejected with. */
export function errorFields(value: unknown): ErrorFields {
  if (value instanceof Error) {
    const fields: ErrorFields = {
      name: truncate(value.name || 'Error', 200),
      message: scrubAndTruncate(value.message || '', LIMITS.maxMessageLength),
    };
    if (typeof value.stack === 'string' && value.stack) {
      fields.stack = scrubAndTruncate(value.stack, LIMITS.maxStackLength);
    }
    return fields;
  }
  if (typeof value === 'string') {
    return { message: scrubAndTruncate(value, LIMITS.maxMessageLength) };
  }
  if (value && typeof value === 'object') {
    const obj = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof obj.message === 'string') {
      const fields: ErrorFields = { message: scrubAndTruncate(obj.message, LIMITS.maxMessageLength) };
      if (typeof obj.name === 'string') fields.name = truncate(obj.name, 200);
      if (typeof obj.stack === 'string') fields.stack = scrubAndTruncate(obj.stack, LIMITS.maxStackLength);
      return fields;
    }
  }
  return { message: scrubAndTruncate(safeStringify(value), LIMITS.maxMessageLength) };
}

type ErrorData = ReproErrorEvent['data'];

export function startErrors(ctx: CaptureContext): Stop {
  const onError = (event: ErrorEvent) => {
    try {
      const fields = event.error !== undefined && event.error !== null ? errorFields(event.error) : { message: '' };
      const data: ErrorData = {
        kind: 'exception',
        handled: false,
        message: fields.message || scrubAndTruncate(event.message || 'Unknown error', LIMITS.maxMessageLength),
      };
      if (fields.name) data.name = fields.name;
      if (fields.stack) data.stack = fields.stack;
      if (event.filename) data.source = truncate(sanitizeUrl(event.filename), LIMITS.maxUrlLength);
      if (typeof event.lineno === 'number' && event.lineno > 0) data.line = event.lineno;
      if (typeof event.colno === 'number' && event.colno > 0) data.column = event.colno;
      ctx.emit({ type: 'error', data });
    } catch (err) {
      ctx.debug('error capture failed', err);
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      const fields = errorFields(event.reason);
      const data: ErrorData = {
        kind: 'unhandledrejection',
        handled: false,
        message: fields.message || 'Unhandled promise rejection',
      };
      if (fields.name) data.name = fields.name;
      if (fields.stack) data.stack = fields.stack;
      ctx.emit({ type: 'error', data });
    } catch (err) {
      ctx.debug('rejection capture failed', err);
    }
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
