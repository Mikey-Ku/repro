import type { RecordedEvent } from '@repro/contracts';
import type { RedactionOptions } from './redact.js';

/** Omit that distributes over a union, so each event type keeps its own `data` shape. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A RecordedEvent before the client stamps `seq` and `ts` on it. */
export type EventBody = DistributiveOmit<RecordedEvent, 'seq' | 'ts'>;

export type Emit = (event: EventBody) => void;
export type Stop = () => void;
export type DebugLog = (...args: unknown[]) => void;

/** Everything a capture module needs. Modules receive this and return a stop function. */
export interface CaptureContext {
  emit: Emit;
  redaction: RedactionOptions;
  /** Ingest endpoint, so network capture can skip the SDK's own uploads. */
  endpoint: string;
  debug: DebugLog;
  /** rrweb checkout cadence override; on-incident mode sets it to half the buffer window. */
  checkoutEveryMs?: number | undefined;
}

/**
 * 'always' uploads continuously. 'on-incident' keeps a rolling in-memory buffer and uploads
 * nothing until something goes wrong, then behaves like 'always' for the rest of the session.
 */
export type ReproMode = 'always' | 'on-incident';

export interface ReproOptions {
  /** Project ingestion key, format rp_... */
  projectKey: string;
  /** Ingest API origin, for example 'http://localhost:4000'. */
  endpoint: string;
  release?: string;
  environment?: string;
  /** Mask every free-text input, not only ones that look sensitive. Default false. */
  strict?: boolean;
  /** Start recording immediately in init(). Default true. */
  autoStart?: boolean;
  /** Upload interval. Default 2000. */
  flushIntervalMs?: number;
  /** Upload as soon as this many events are buffered. Default 200. */
  maxBatchEvents?: number;
  /** Extra selector whose text and input values are masked. */
  maskSelector?: string;
  /** Extra selector whose subtree is replaced by a placeholder box. */
  blockSelector?: string;
  /** Extra selector whose inputs are not recorded. */
  ignoreSelector?: string;
  /** Capture console.error and console.warn. Default true. */
  captureConsole?: boolean;
  /** Capture fetch and XHR method, url, status and duration. Never headers or bodies. Default true. */
  captureNetwork?: boolean;
  /** Fraction of sessions recorded, 0 to 1. Default 1. */
  sampleRate?: number;
  /** Session id override (tests). Otherwise persisted per tab in sessionStorage. */
  sessionId?: string;
  /** Log SDK activity to console.debug. */
  debug?: boolean;
  /**
   * Default 'always'. In 'on-incident' mode nothing is uploaded until an uncaught exception, an
   * unhandled rejection, captureException(), a failed request (5xx or network error) or
   * flagIncident(); the events leading up to it are then uploaded from the buffer.
   */
  mode?: ReproMode;
  /** on-incident only: seconds of history kept in memory before an incident. Default 30. */
  bufferSeconds?: number;
  /** on-incident only: most events kept in memory before an incident. Default 2000. */
  bufferEvents?: number;
}

export interface ReproClient {
  start(): void;
  /**
   * Stops capture and sends the final batch with `final: true`. In on-incident mode before any
   * incident it discards the buffer instead, so a healthy session leaves nothing behind.
   */
  stop(): void;
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  /** Rejects email-shaped ids and drops trait keys that look sensitive. */
  identify(userId: string, traits?: Record<string, string | number | boolean>): void;
  annotate(name: string, data?: Record<string, string | number | boolean>): void;
  /** Records an `incident:<reason>` annotation and, in on-incident mode, starts uploading. */
  flagIncident(reason: string, data?: Record<string, string | number | boolean>): void;
  /** Resolves when every queued upload has finished (or been given up on). */
  flush(): Promise<void>;
  getSessionId(): string | null;
  /** True while capturing, including while on-incident mode is only buffering. */
  isRecording(): boolean;
  /** The effective mode: 'on-incident' while buffering, 'always' otherwise or after an incident. */
  getMode(): ReproMode;
  /** True once an incident has switched this session to uploading. Survives page loads. */
  hasTriggered(): boolean;
}
