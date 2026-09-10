/**
 * Redaction glue between the DOM and the pure helpers in @repro/contracts.
 * Everything here answers one of two questions: "is this element secret?" and
 * "is this piece of text safe to send?". The capture modules never decide on their own.
 */
import {
  isSensitiveField,
  isSensitiveFieldHint,
  scrubText,
  truncate,
  LIMITS,
  REDACTED,
  type FieldSensitivityInput,
} from '@repro/contracts';

export const MASK_ATTRIBUTE = 'data-repro-mask';
export const BLOCK_ATTRIBUTE = 'data-repro-block';
export const IGNORE_ATTRIBUTE = 'data-repro-ignore';

/** Selectors honoured by default, before any user-supplied selector is appended. */
export const DEFAULT_MASK_SELECTOR = `[${MASK_ATTRIBUTE}], .rr-mask`;
export const DEFAULT_BLOCK_SELECTOR = `[${BLOCK_ATTRIBUTE}], .rr-block`;
export const DEFAULT_IGNORE_SELECTOR = `[${IGNORE_ATTRIBUTE}], .rr-ignore`;

export interface RedactionOptions {
  strict: boolean;
  maskSelector?: string;
  blockSelector?: string;
  ignoreSelector?: string;
}

/** Combine a default selector with an optional user selector into one selector list. */
export function joinSelectors(base: string, extra?: string): string {
  const trimmed = extra?.trim();
  return trimmed ? `${base}, ${trimmed}` : base;
}

/** `Element.closest` that treats an invalid user selector as "no match" instead of throwing. */
export function closestSafe(el: Element | null, selector: string): Element | null {
  if (!el) return null;
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

export function isInsideMasked(el: Element | null, opts: RedactionOptions): boolean {
  return closestSafe(el, joinSelectors(DEFAULT_MASK_SELECTOR, opts.maskSelector)) !== null;
}

export function isInsideBlocked(el: Element | null, opts: RedactionOptions): boolean {
  return closestSafe(el, joinSelectors(DEFAULT_BLOCK_SELECTOR, opts.blockSelector)) !== null;
}

export function isInsideIgnored(el: Element | null, opts: RedactionOptions): boolean {
  return closestSafe(el, joinSelectors(DEFAULT_IGNORE_SELECTOR, opts.ignoreSelector)) !== null;
}

/** True when text derived from this element must not leave the page. */
export function isTextRedacted(el: Element | null, opts: RedactionOptions): boolean {
  return isInsideMasked(el, opts) || isInsideBlocked(el, opts);
}

/** Collapse whitespace so labels and button text compare cleanly. */
export function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The `<label>` element associated with a control, via `for` or by wrapping it. */
export function associatedLabel(el: Element): HTMLLabelElement | null {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) return labels[0] ?? null;
  if (el.id) {
    const root = el.ownerDocument;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&');
    try {
      const byFor = root.querySelector<HTMLLabelElement>(`label[for="${escaped}"]`);
      if (byFor) return byFor;
    } catch {
      // unusual id characters; fall through to the wrapping label
    }
  }
  return el.closest('label');
}

/** Visible text of the associated label, used both as a redaction hint and in descriptors. */
export function labelTextFor(el: Element): string | undefined {
  const label = associatedLabel(el);
  if (!label) return undefined;
  const text = cleanText(label.textContent);
  return text ? truncate(text, LIMITS.maxElementTextLength) : undefined;
}

/** Everything `isSensitiveField` wants to know about a form control, read from the DOM once. */
export function fieldSensitivityInput(el: Element, opts: RedactionOptions): FieldSensitivityInput {
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    id: el.id || null,
    autocomplete: el.getAttribute('autocomplete'),
    placeholder: el.getAttribute('placeholder'),
    label: labelTextFor(el) ?? null,
    ariaLabel: el.getAttribute('aria-label'),
    // Masked and blocked regions both hide the control from the viewer, so neither may record values.
    explicitMask: isTextRedacted(el, opts),
    strict: opts.strict,
  };
}

/** Decide whether a control's value must be masked. Biased towards masking. */
export function isSensitiveElement(el: Element, opts: RedactionOptions): boolean {
  return isSensitiveField(fieldSensitivityInput(el, opts));
}

/** Same-length star mask so the replay keeps the field's visual width. */
export function maskValue(text: string): string {
  return '*'.repeat(text.length);
}

/** Free text (messages, console args) gets inline secrets scrubbed, then a hard length cap. */
export function scrubAndTruncate(text: string, max: number): string {
  return truncate(scrubText(text), max);
}

/** Text that may have come from a masked region is replaced entirely, never partially. */
export function redactedText(): string {
  return REDACTED;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** identify() refuses ids that are really email addresses; those belong to the customer, not to us. */
export function isEmailShaped(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

export type Primitive = string | number | boolean;

/**
 * Clean a user-supplied record (traits, annotation data, exception context): drop keys that hint
 * at secrets, cap the number of keys, scrub and truncate string values.
 */
export function sanitizeRecord(
  input: Record<string, unknown> | undefined,
  limits: { maxKeys: number; maxValueLength: number; dropSensitiveKeys: boolean },
): Record<string, Primitive> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, Primitive> = {};
  let count = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (count >= limits.maxKeys) break;
    const key = truncate(rawKey, 64);
    if (limits.dropSensitiveKeys && isSensitiveFieldHint(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = scrubAndTruncate(value, limits.maxValueLength);
    } else {
      continue;
    }
    count += 1;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * JSON.stringify that cannot throw or recurse forever: depth-limited, cycle-safe, and it
 * converts Errors and functions into short readable strings. Used for console args.
 * Object keys that look like secrets (`password`, `apiKey`, `token`) have their values
 * replaced, because `scrubText` only understands `key=value` text, not quoted JSON keys.
 */
export function safeStringify(value: unknown, maxDepth = 3): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return `${v.toString()}n`;
    if (typeof v === 'symbol') return v.toString();
    if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      if (depth >= maxDepth) return Array.isArray(v) ? '[Array]' : '[Object]';
      seen.add(v);
      if (Array.isArray(v)) return v.slice(0, 100).map((item) => walk(item, depth + 1));
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const key of Object.keys(v)) {
        if (count >= 100) break;
        out[key] = isSensitiveFieldHint(key) ? REDACTED : walk((v as Record<string, unknown>)[key], depth + 1);
        count += 1;
      }
      return out;
    }
    return String(v);
  };
  try {
    const result = walk(value, 0);
    return typeof result === 'string' ? result : (JSON.stringify(result) ?? 'undefined');
  } catch {
    return '[unserializable]';
  }
}

/** Convert one console argument into a string safe to store. */
export function formatConsoleArg(arg: unknown): string {
  const text = typeof arg === 'string' ? arg : safeStringify(arg);
  return scrubAndTruncate(text, LIMITS.maxMessageLength);
}
