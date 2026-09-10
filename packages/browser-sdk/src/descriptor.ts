/**
 * Turn a DOM element into an ElementDescriptor: stable, human-meaningful attributes that a
 * test generator can turn into a selector. Never contains the element's value and never
 * contains rrweb node ids.
 */
import { sanitizeUrl, truncate, LIMITS, type ElementDescriptor } from '@repro/contracts';
import {
  cleanText,
  isSensitiveElement,
  isTextRedacted,
  labelTextFor,
  redactedText,
  type RedactionOptions,
} from './redact.js';

export type DescribeOptions = RedactionOptions;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'search', 'tel', 'url', 'password', 'number']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TEXT_BEARING = new Set(['button', 'a', 'summary', 'option']);
const MAX_PATH_DEPTH = 5;

/** Ids produced by frameworks (React useId, Radix, Headless UI, counters) change between builds. */
export function isStableId(id: string): boolean {
  if (!id) return false;
  if (id.includes(':')) return false;
  if (/^(radix|headlessui)/i.test(id)) return false;
  if (/\d{5,}/.test(id)) return false;
  return true;
}

function implicitRole(el: Element, tag: string, type: string): string | undefined {
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (TEXT_INPUT_TYPES.has(type)) return 'textbox';
    return undefined;
  }
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (HEADINGS.has(tag)) return 'heading';
  return undefined;
}

function labelledByText(el: Element): string | undefined {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return undefined;
  const parts = ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => cleanText(el.ownerDocument.getElementById(id)?.textContent))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

interface NameSource {
  value: string;
  /** True when the name came from page text rather than an authored attribute. */
  fromText: boolean;
}

function accessibleName(el: Element, tag: string, label: string | undefined): NameSource | undefined {
  const aria = cleanText(el.getAttribute('aria-label'));
  if (aria) return { value: aria, fromText: false };
  const labelledBy = labelledByText(el);
  if (labelledBy) return { value: labelledBy, fromText: true };
  if (label) return { value: label, fromText: true };
  if (tag === 'button' || tag === 'a') {
    const text = cleanText(el.textContent);
    if (text) return { value: text, fromText: true };
  }
  const alt = cleanText(el.getAttribute('alt'));
  if (alt) return { value: alt, fromText: false };
  const title = cleanText(el.getAttribute('title'));
  if (title) return { value: title, fromText: false };
  const placeholder = cleanText(el.getAttribute('placeholder'));
  if (placeholder) return { value: placeholder, fromText: false };
  return undefined;
}

/**
 * A short CSS path: `form#login > div:nth-of-type(2) > input`. Stops early at a stable id
 * because that already pins the element, and caps depth so paths stay readable.
 */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1 && parts.length < MAX_PATH_DEPTH) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag);
      break;
    }
    if (current.id && isStableId(current.id)) {
      parts.unshift(`${tag}#${current.id}`);
      break;
    }
    let selector = tag;
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
      if (sameTag.length > 1) selector += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    parts.unshift(selector);
    current = parent;
  }
  return truncate(parts.join(' > '), 500);
}

const attr = (el: Element, name: string, max: number): string | undefined => {
  const value = el.getAttribute(name);
  return value ? truncate(value, max) : undefined;
};

export function describeElement(el: Element, opts: DescribeOptions): ElementDescriptor {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const redacted = isTextRedacted(el, opts);
  const maxText = LIMITS.maxElementTextLength;

  const descriptor: ElementDescriptor = {
    tag: truncate(tag, 32),
    sensitive: isSensitiveElement(el, opts),
  };

  const testId = attr(el, 'data-testid', 200);
  if (testId) descriptor.testId = testId;
  if (el.id && isStableId(el.id)) descriptor.id = truncate(el.id, 200);
  const name = attr(el, 'name', 200);
  if (name) descriptor.name = name;
  if (type) descriptor.type = truncate(type, 32);
  const role = cleanText(el.getAttribute('role')) || implicitRole(el, tag, type);
  if (role) descriptor.role = truncate(role, 64);

  // Text-derived fields are replaced wholesale inside masked or blocked regions.
  const rawLabel = labelTextFor(el);
  const label = rawLabel ? (redacted ? redactedText() : rawLabel) : undefined;
  if (label) descriptor.label = truncate(label, maxText);

  const nameSource = accessibleName(el, tag, rawLabel);
  if (nameSource) {
    descriptor.accessibleName = truncate(redacted && nameSource.fromText ? redactedText() : nameSource.value, maxText);
  }

  const placeholder = attr(el, 'placeholder', maxText);
  if (placeholder) descriptor.placeholder = placeholder;

  if (TEXT_BEARING.has(tag)) {
    const text = cleanText(el.textContent);
    if (text) descriptor.text = truncate(redacted ? redactedText() : text, maxText);
  }

  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href) descriptor.href = truncate(sanitizeUrl(href, el.ownerDocument.baseURI || undefined), LIMITS.maxUrlLength);
  }

  const ariaLabel = attr(el, 'aria-label', maxText);
  if (ariaLabel) descriptor.ariaLabel = ariaLabel;
  const autocomplete = attr(el, 'autocomplete', 64);
  if (autocomplete) descriptor.autocomplete = autocomplete;

  descriptor.cssPath = cssPath(el);

  const form = tag === 'form' ? null : (el as HTMLInputElement).form ?? el.closest('form');
  if (form) {
    if (form.id && isStableId(form.id)) descriptor.formId = truncate(form.id, 200);
    const formTestId = attr(form, 'data-testid', 200);
    if (formTestId) descriptor.formTestId = formTestId;
  }

  return descriptor;
}
