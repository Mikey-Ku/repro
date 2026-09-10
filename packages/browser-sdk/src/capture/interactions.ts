/**
 * Click, change and submit capture. Listeners run in the capture phase on `document` so a
 * page calling stopPropagation cannot hide an interaction from the recording.
 */
import { truncate, LIMITS, type InputKind } from '@repro/contracts';
import { describeElement } from '../descriptor.js';
import { cleanText, isInsideIgnored, isSensitiveElement, isTextRedacted, redactedText } from '../redact.js';
import type { CaptureContext, Stop } from '../types.js';

/** The element a click is "about": the nearest control, not the span inside it. */
export const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, [role], [data-testid], summary';

export function clickTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  try {
    return target.closest(INTERACTIVE_SELECTOR) ?? target;
  } catch {
    return target;
  }
}

export function inputKind(el: Element): InputKind {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['file', 'submit', 'button', 'reset', 'image', 'hidden', 'range', 'color'].includes(type)) return 'other';
    return 'text';
  }
  return 'other';
}

export function startInteractions(ctx: CaptureContext): Stop {
  const { emit, redaction } = ctx;

  const onClick = (event: MouseEvent) => {
    const el = clickTarget(event.target);
    if (!el) return;
    try {
      emit({
        type: 'click',
        data: {
          target: describeElement(el, redaction),
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
        },
      });
    } catch (err) {
      ctx.debug('click capture failed', err);
    }
  };

  const onChange = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    // Ignored regions produce no event at all, not even a masked one.
    if (isInsideIgnored(el, redaction)) return;
    try {
      const kind = inputKind(el);
      const target = describeElement(el, redaction);
      const masked = kind === 'other' || isSensitiveElement(el, redaction);
      const control = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const data: Extract<Parameters<typeof emit>[0], { type: 'input' }>['data'] = {
        target,
        kind,
        value: masked ? null : truncate(String(control.value ?? ''), LIMITS.maxInputValueLength),
        masked,
      };
      if (kind === 'checkbox' || kind === 'radio') {
        data.checked = (el as HTMLInputElement).checked;
      }
      if (kind === 'select' && !masked) {
        const select = el as HTMLSelectElement;
        const option = select.options[select.selectedIndex];
        const text = option ? cleanText(option.textContent) : '';
        if (text) target.text = truncate(isTextRedacted(el, redaction) ? redactedText() : text, LIMITS.maxElementTextLength);
      }
      emit({ type: 'input', data });
    } catch (err) {
      ctx.debug('input capture failed', err);
    }
  };

  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof Element)) return;
    try {
      emit({ type: 'submit', data: { target: describeElement(form, redaction) } });
    } catch (err) {
      ctx.debug('submit capture failed', err);
    }
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
  };
}
