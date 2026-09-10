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
}

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
}

export interface ReproClient {
  start(): void;
  /** Stops capture and sends the final batch with `final: true`. */
  stop(): void;
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  /** Rejects email-shaped ids and drops trait keys that look sensitive. */
  identify(userId: string, traits?: Record<string, string | number | boolean>): void;
  annotate(name: string, data?: Record<string, string | number | boolean>): void;
  /** Resolves when every queued upload has finished (or been given up on). */
  flush(): Promise<void>;
  getSessionId(): string | null;
  isRecording(): boolean;
}
