/**
 * rrweb integration. rrweb does the DOM recording; this file only decides the privacy options
 * and forwards events. Everything rrweb emits becomes one `rrweb` RecordedEvent.
 */
import { record, type recordOptions } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { sanitizeRrwebEvent } from '@repro/contracts/runtime';
import {
  DEFAULT_BLOCK_SELECTOR,
  DEFAULT_IGNORE_SELECTOR,
  DEFAULT_MASK_SELECTOR,
  isInsideIgnored,
  isSensitiveElement,
  joinSelectors,
  maskValue,
  type RedactionOptions,
} from '../redact.js';
import type { CaptureContext, Stop } from '../types.js';

/** A fresh full snapshot every minute keeps replays seekable and bounds the cost of a lost batch. */
export const CHECKOUT_EVERY_MS = 60_000;

/**
 * rrweb only consults `maskInputFn` when `maskInputOptions[tagName] || maskInputOptions[type]`
 * is true. Keying on the tag names means every control reaches our function, including
 * `type="hidden"` (which rrweb's own list omits) and any input type a future browser adds.
 * `maskInputFn` then returns the value unchanged for controls that are not sensitive.
 *
 * We never set `maskAllInputs`: rrweb replaces `maskInputOptions` with its fixed list when it
 * is true, which would drop the hidden type again. Strict mode is applied inside
 * `isSensitiveField` instead, which masks every free-text control when `strict` is set.
 */
export const INPUT_MASK_OPTIONS = {
  input: true,
  textarea: true,
  select: true,
  password: true,
  hidden: true,
} as const;

/** Values inside an ignored region are never recorded, not even in the initial snapshot. */
export function buildMaskInputFn(redaction: RedactionOptions): (text: string, el: HTMLElement) => string {
  return (text, el) => (isInsideIgnored(el, redaction) || isSensitiveElement(el, redaction) ? maskValue(text) : text);
}

export type RecordOptions = recordOptions<eventWithTime>;
type MaskInputOptions = NonNullable<RecordOptions['maskInputOptions']>;

export function buildRecordOptions(ctx: CaptureContext): RecordOptions {
  const { redaction } = ctx;
  const options: RecordOptions = {
    emit: (event: eventWithTime) => {
      // rrweb copies the page URL and link/form URLs verbatim; redact their query strings first.
      ctx.emit({ type: 'rrweb', data: sanitizeRrwebEvent(event) });
    },
    checkoutEveryNms: CHECKOUT_EVERY_MS,
    maskTextSelector: joinSelectors(DEFAULT_MASK_SELECTOR, redaction.maskSelector),
    blockSelector: joinSelectors(DEFAULT_BLOCK_SELECTOR, redaction.blockSelector),
    ignoreSelector: joinSelectors(DEFAULT_IGNORE_SELECTOR, redaction.ignoreSelector),
    maskInputFn: buildMaskInputFn(redaction),
    // rrweb's MaskInputOptions type lists input types only; the tag-name keys are honoured at
    // runtime (see INPUT_MASK_OPTIONS), so widen the type rather than lose them.
    maskInputOptions: INPUT_MASK_OPTIONS as MaskInputOptions,
    recordCanvas: false,
    inlineStylesheet: true,
    sampling: { mousemove: 50, scroll: 150, input: 'last' },
    slimDOMOptions: { script: true, comment: true },
  };
  return options;
}

export function startRrweb(ctx: CaptureContext): Stop {
  try {
    const stop = record(buildRecordOptions(ctx));
    return () => {
      try {
        stop?.();
      } catch (err) {
        ctx.debug('rrweb stop failed', err);
      }
    };
  } catch (err) {
    // A recorder failure must never break the host page; the other capture modules still run.
    ctx.debug('rrweb failed to start', err);
    return () => {};
  }
}
