/**
 * Hard limits shared by the SDK (to stay under them) and the ingest API (to enforce them).
 * The server treats anything over these as malformed and rejects the whole batch.
 */
export const LIMITS = {
  /** Maximum decompressed batch size in bytes. */
  maxBatchBytes: 2_000_000,
  /** Maximum events per batch. */
  maxEventsPerBatch: 2_000,
  /** Maximum length for free-form strings such as error messages and console args. */
  maxMessageLength: 2_000,
  /** Maximum length for a stack trace. */
  maxStackLength: 8_000,
  /** Maximum length of a URL after sanitisation. */
  maxUrlLength: 2_048,
  /** Maximum length of a captured input value (non-sensitive fields only). */
  maxInputValueLength: 500,
  /** Maximum length of text captured from an element (button labels etc). */
  maxElementTextLength: 120,
  /** Maximum console args per console event. */
  maxConsoleArgs: 10,
  /** Maximum annotation keys. */
  maxAnnotationKeys: 20,
  /** Maximum sessions returned by a list call. */
  maxPageSize: 100,
} as const;

export const SCHEMA_VERSION = 1 as const;
