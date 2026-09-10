import { sanitizeUrl } from './sanitize.js';

/**
 * rrweb records the page URL in its Meta event and copies URL-bearing attributes (href, src,
 * form action) into snapshots and mutations. Those must go through the same query-string
 * redaction as every other URL Repro captures. This walker mutates the event in place and
 * returns it; it only touches string attributes that carry a query string or fragment.
 */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data', 'xlink:href', 'cite', 'longdesc']);

const META = 4;
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION_SOURCE = 0;

interface SerializedNode {
  type?: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
}

/** Redact query and fragment parameters in an attribute value without changing its shape otherwise. */
export function sanitizeUrlAttribute(value: string): string {
  if (!value.includes('?') && !value.includes('#')) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return sanitizeUrl(value);
  // Relative reference: resolve against a throwaway base, then strip the base again.
  const base = 'http://relative.invalid';
  const absolute = sanitizeUrl(value, base);
  return absolute.startsWith(base) ? absolute.slice(base.length) : absolute;
}

/** Redact query strings inside CSS url(...) references, as found in inline styles and stylesheets. */
export function sanitizeCssUrls(css: string): string {
  if (!css.includes('url(')) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote: string, target: string) => `url(${quote}${sanitizeUrlAttribute(target)}${quote})`);
}

function sanitizeAttributes(attributes: Record<string, unknown> | undefined): void {
  if (!attributes) return;
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') continue;
    const lower = name.toLowerCase();
    if (URL_ATTRIBUTES.has(lower)) {
      attributes[name] = sanitizeUrlAttribute(value);
    } else if (lower === 'style' || lower === '_csstext') {
      attributes[name] = sanitizeCssUrls(value);
    }
  }
}

function walk(node: SerializedNode | undefined): void {
  if (!node || typeof node !== 'object') return;
  sanitizeAttributes(node.attributes);
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) walk(child);
  }
}

export function sanitizeRrwebEvent<T extends { type: number; data: unknown }>(event: T): T {
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return event;
  if (event.type === META && typeof data.href === 'string') {
    data.href = sanitizeUrl(data.href);
  } else if (event.type === FULL_SNAPSHOT) {
    walk(data.node as SerializedNode | undefined);
  } else if (event.type === INCREMENTAL && data.source === MUTATION_SOURCE) {
    const adds = data.adds as { node?: SerializedNode }[] | undefined;
    if (Array.isArray(adds)) for (const add of adds) walk(add?.node);
    const attributes = data.attributes as { attributes?: Record<string, unknown> }[] | undefined;
    if (Array.isArray(attributes)) for (const change of attributes) sanitizeAttributes(change?.attributes);
  }
  return event;
}
