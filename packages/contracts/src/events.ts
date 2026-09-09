import { z } from 'zod';
import { LIMITS, SCHEMA_VERSION } from './limits.js';

const shortString = (max: number) => z.string().max(max);

/**
 * Describes the element a user interacted with, using only stable, human-meaningful
 * attributes. It never contains rrweb node ids, which change between recordings.
 */
export const ElementDescriptorSchema = z.object({
  tag: shortString(32),
  testId: shortString(200).optional(),
  id: shortString(200).optional(),
  name: shortString(200).optional(),
  type: shortString(32).optional(),
  role: shortString(64).optional(),
  accessibleName: shortString(LIMITS.maxElementTextLength).optional(),
  label: shortString(LIMITS.maxElementTextLength).optional(),
  placeholder: shortString(LIMITS.maxElementTextLength).optional(),
  text: shortString(LIMITS.maxElementTextLength).optional(),
  href: shortString(LIMITS.maxUrlLength).optional(),
  ariaLabel: shortString(LIMITS.maxElementTextLength).optional(),
  autocomplete: shortString(64).optional(),
  cssPath: shortString(500).optional(),
  /** True when the SDK decided this control carries secret data. Values are masked. */
  sensitive: z.boolean().default(false),
  /** Whether the element sits inside a <form>, and that form's descriptor if so. */
  formId: shortString(200).optional(),
  formTestId: shortString(200).optional(),
});
export type ElementDescriptor = z.infer<typeof ElementDescriptorSchema>;

const base = {
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
};

/** rrweb `eventWithTime`. Kept opaque; the replayer owns its shape. */
export const RrwebEventSchema = z.object({
  ...base,
  type: z.literal('rrweb'),
  data: z.looseObject({
    type: z.number().int(),
    timestamp: z.number(),
    data: z.unknown(),
  }),
});

export const ClickEventSchema = z.object({
  ...base,
  type: z.literal('click'),
  data: z.object({
    target: ElementDescriptorSchema,
    x: z.number().optional(),
    y: z.number().optional(),
  }),
});

export const InputKind = z.enum(['text', 'textarea', 'select', 'checkbox', 'radio', 'other']);
export type InputKind = z.infer<typeof InputKind>;

export const InputEventSchema = z.object({
  ...base,
  type: z.literal('input'),
  data: z.object({
    target: ElementDescriptorSchema,
    kind: InputKind,
    /** Null when masked. Never contains a value for a sensitive field. */
    value: shortString(LIMITS.maxInputValueLength).nullable(),
    masked: z.boolean(),
    checked: z.boolean().optional(),
  }),
});

export const SubmitEventSchema = z.object({
  ...base,
  type: z.literal('submit'),
  data: z.object({
    target: ElementDescriptorSchema,
  }),
});

export const NavigationKind = z.enum(['load', 'push', 'replace', 'pop', 'hash']);
export type NavigationKind = z.infer<typeof NavigationKind>;

export const NavigationEventSchema = z.object({
  ...base,
  type: z.literal('navigation'),
  data: z.object({
    url: shortString(LIMITS.maxUrlLength),
    kind: NavigationKind,
    title: shortString(200).optional(),
  }),
});

export const ErrorEventSchema = z.object({
  ...base,
  type: z.literal('error'),
  data: z.object({
    kind: z.enum(['exception', 'unhandledrejection', 'captured']),
    name: shortString(200).optional(),
    message: shortString(LIMITS.maxMessageLength),
    stack: shortString(LIMITS.maxStackLength).optional(),
    handled: z.boolean(),
    source: shortString(LIMITS.maxUrlLength).optional(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    context: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  }),
});

export const ConsoleEventSchema = z.object({
  ...base,
  type: z.literal('console'),
  data: z.object({
    level: z.enum(['error', 'warn']),
    args: z.array(shortString(LIMITS.maxMessageLength)).max(LIMITS.maxConsoleArgs),
  }),
});

export const NetworkEventSchema = z.object({
  ...base,
  type: z.literal('network'),
  data: z.object({
    kind: z.enum(['fetch', 'xhr']),
    method: shortString(16),
    /** Sanitised absolute URL (no sensitive params). */
    url: shortString(LIMITS.maxUrlLength),
    /** Sanitised path and query, for grouping. */
    path: shortString(LIMITS.maxUrlLength),
    status: z.number().int().nullable(),
    ok: z.boolean(),
    durationMs: z.number().nonnegative(),
    /** Network-level failure (CORS, offline, abort). */
    error: shortString(LIMITS.maxMessageLength).optional(),
    requestId: shortString(64),
  }),
});

export const AnnotationEventSchema = z.object({
  ...base,
  type: z.literal('annotation'),
  data: z.object({
    name: shortString(100),
    data: z
      .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
      .optional(),
  }),
});

export const IdentifyEventSchema = z.object({
  ...base,
  type: z.literal('identify'),
  data: z.object({
    /** An opaque id chosen by the application. The SDK refuses email-shaped values. */
    userId: shortString(200).optional(),
    traits: z
      .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()]))
      .optional(),
  }),
});

export const RecordedEventSchema = z.discriminatedUnion('type', [
  RrwebEventSchema,
  ClickEventSchema,
  InputEventSchema,
  SubmitEventSchema,
  NavigationEventSchema,
  ErrorEventSchema,
  ConsoleEventSchema,
  NetworkEventSchema,
  AnnotationEventSchema,
  IdentifyEventSchema,
]);
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;
export type RecordedEventType = RecordedEvent['type'];
export type RrwebEvent = z.infer<typeof RrwebEventSchema>;
export type ClickEvent = z.infer<typeof ClickEventSchema>;
export type InputEvent = z.infer<typeof InputEventSchema>;
export type SubmitEvent = z.infer<typeof SubmitEventSchema>;
export type NavigationEvent = z.infer<typeof NavigationEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type ConsoleEvent = z.infer<typeof ConsoleEventSchema>;
export type NetworkEvent = z.infer<typeof NetworkEventSchema>;
export type AnnotationEvent = z.infer<typeof AnnotationEventSchema>;
export type IdentifyEvent = z.infer<typeof IdentifyEventSchema>;

export const SessionMetaSchema = z.object({
  startedAt: z.number().int().positive(),
  sdkVersion: shortString(32),
  release: shortString(100).optional(),
  environment: shortString(50).optional(),
  browser: z.object({
    name: shortString(50),
    version: shortString(50),
    userAgent: shortString(500),
  }),
  os: shortString(50).optional(),
  viewport: z.object({
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    devicePixelRatio: z.number().positive().optional(),
  }),
  page: z.object({
    url: shortString(LIMITS.maxUrlLength),
    title: shortString(200).optional(),
    referrer: shortString(LIMITS.maxUrlLength).optional(),
  }),
  locale: shortString(20).optional(),
  timezone: shortString(64).optional(),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

/** One upload from the SDK. Batches are idempotent on (sessionId, batchSeq). */
export const IngestBatchSchema = z.object({
  v: z.literal(SCHEMA_VERSION),
  sessionId: z.uuid(),
  batchSeq: z.number().int().nonnegative(),
  sentAt: z.number().int().positive(),
  meta: SessionMetaSchema.optional(),
  events: z.array(RecordedEventSchema).max(LIMITS.maxEventsPerBatch),
  /** True on the last batch of a session. Marks the session completed. */
  final: z.boolean().optional(),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

export const IngestResponseSchema = z.object({
  ok: z.literal(true),
  sessionId: z.uuid(),
  batchSeq: z.number().int(),
  accepted: z.boolean(),
  duplicate: z.boolean(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
