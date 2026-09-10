/**
 * Zod-free entry for the browser SDK. Everything here is pure data manipulation: limits,
 * URL and text redaction, rrweb URL redaction and event normalisation. Types are erased at
 * build time, so the SDK can still import them from the main entry without pulling in zod.
 */
export * from './limits.js';
export * from './sanitize.js';
export * from './rrweb.js';
export * from './normalize.js';
