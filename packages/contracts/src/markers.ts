import type { RecordedEvent } from './events.js';

/**
 * What a recording says the page showed. Gathered from rrweb full snapshots and mutation adds
 * (which is where the DOM lives in a session) plus the navigation stream (for the final path).
 *
 * A recording of a failure never contains the success state, so the way to learn what "fixed"
 * looks like is to compare a failing session's markers with a passing session's on the same
 * route: whatever appears only in the passing one is a candidate expectation. Only stable,
 * author-written signals are collected: `data-testid` values, the text of live regions
 * (`role="status"` or `aria-live`) and the text of h1..h3. Nothing here is an rrweb node id.
 */
export interface DomMarkers {
  /** Every distinct `data-testid` value seen, in first-seen order. */
  testIds: string[];
  /** Text content of elements with `role="status"` or an `aria-live` attribute. */
  statusTexts: string[];
  /** Text content of h1, h2 and h3 elements. */
  headings: string[];
  /** Pathname of the last navigation event, or null when the session recorded no navigation. */
  finalPath: string | null;
}

// rrweb event types and serialized node types. Mirrored here rather than imported so the
// contracts package stays free of the rrweb dependency; the shapes are stable across rrweb 2.x.
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION_SOURCE = 0;
const ELEMENT_NODE = 2;
const TEXT_NODE = 3;

const HEADING_TAGS = new Set(['h1', 'h2', 'h3']);

interface SerializedNode {
  type?: number;
  id?: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
  textContent?: string;
}

/** What is remembered about a node between events, so a later text add or change can be attributed to its element. */
interface KnownNode {
  parentId: number | null;
  tag: string | null;
  attributes: Record<string, unknown>;
  /** Text of this node's own text-node children, by child id. Only kept for interesting elements. */
  texts: Map<number, string>;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    const cut = url.split(/[?#]/)[0] ?? url;
    return cut.startsWith('/') ? cut : null;
  }
}

/** Insertion-ordered set as a list, ignoring empty strings. */
class OrderedTexts {
  private readonly seen = new Set<string>();
  readonly values: string[] = [];
  add(text: string): void {
    const value = collapse(text);
    if (!value || this.seen.has(value)) return;
    this.seen.add(value);
    this.values.push(value);
  }
}

function isStatusElement(node: { tag: string | null; attributes: Record<string, unknown> }): boolean {
  const role = node.attributes.role;
  if (typeof role === 'string' && role.split(/\s+/).includes('status')) return true;
  const live = node.attributes['aria-live'];
  return typeof live === 'string' && live !== '' && live !== 'off';
}

function isHeading(node: { tag: string | null }): boolean {
  return node.tag !== null && HEADING_TAGS.has(node.tag);
}

/** Concatenated text of a serialized subtree, in document order. */
function subtreeText(node: SerializedNode): string {
  if (node.type === TEXT_NODE) return typeof node.textContent === 'string' ? node.textContent : '';
  if (!Array.isArray(node.childNodes)) return '';
  return node.childNodes.map(subtreeText).join(' ');
}

class MarkerCollector {
  readonly testIds = new OrderedTexts();
  readonly statusTexts = new OrderedTexts();
  readonly headings = new OrderedTexts();
  private readonly nodes = new Map<number, KnownNode>();

  /** Walk a serialized subtree (snapshot root or a mutation add), recording elements and their markers. */
  visit(node: SerializedNode | undefined, parentId: number | null): void {
    if (!node || typeof node !== 'object') return;
    const id = typeof node.id === 'number' ? node.id : null;

    if (node.type === TEXT_NODE) {
      // Register only: the element's own visit already reported its complete text. Emitting here
      // would report partial strings ("Order" before "Order placed") for multi-node content.
      if (id !== null && parentId !== null) this.registerText(id, parentId, node.textContent ?? '');
      return;
    }

    if (node.type === ELEMENT_NODE) {
      const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : null;
      const attributes = node.attributes && typeof node.attributes === 'object' ? node.attributes : {};
      const known: KnownNode = { parentId, tag, attributes, texts: new Map() };
      if (id !== null) this.nodes.set(id, known);

      const testId = attributes['data-testid'];
      if (typeof testId === 'string') this.testIds.add(testId);
      if (isStatusElement(known)) this.statusTexts.add(subtreeText(node));
      if (isHeading(known)) this.headings.add(subtreeText(node));
    }

    if (Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) this.visit(child, id);
    }
  }

  /** Remember a text node and its value under its parent, without reporting anything. */
  private registerText(textId: number, parentId: number, value: string): KnownNode | null {
    const parent = this.nodes.get(parentId);
    if (!parent) return null;
    this.nodes.set(textId, { parentId, tag: null, attributes: {}, texts: new Map() });
    parent.texts.set(textId, value);
    return parent;
  }

  /** A text node under a known element arrived on its own or changed its value: report the parent's new text. */
  textChanged(textId: number, parentId: number, value: string): void {
    const parent = this.registerText(textId, parentId, value);
    if (!parent) return;
    const combined = [...parent.texts.values()].join(' ');
    if (isStatusElement(parent)) this.statusTexts.add(combined);
    if (isHeading(parent)) this.headings.add(combined);
  }

  /** `texts` entries in a mutation: the text node already exists, so find its parent through the map. */
  textMutated(textId: number, value: string): void {
    const text = this.nodes.get(textId);
    if (!text || text.parentId === null) return;
    this.textChanged(textId, text.parentId, value);
  }

  /** Attribute changes can introduce a test id or turn an element into a live region. */
  attributesChanged(id: number, changed: Record<string, unknown>): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.attributes = { ...node.attributes, ...changed };
    const testId = changed['data-testid'];
    if (typeof testId === 'string') this.testIds.add(testId);
    if (('role' in changed || 'aria-live' in changed) && isStatusElement(node)) {
      this.statusTexts.add([...node.texts.values()].join(' '));
    }
  }
}

/**
 * Pure and deterministic: events are sorted by `seq` first, so arrival order does not matter,
 * and the output lists are in first-seen order with duplicates removed.
 */
export function extractDomMarkers(events: readonly RecordedEvent[]): DomMarkers {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const collector = new MarkerCollector();
  let finalPath: string | null = null;

  for (const event of ordered) {
    if (event.type === 'navigation') {
      finalPath = pathOf(event.data.url) ?? finalPath;
      continue;
    }
    if (event.type !== 'rrweb') continue;

    const payload = event.data.data as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== 'object') continue;

    if (event.data.type === FULL_SNAPSHOT) {
      collector.visit(payload.node as SerializedNode | undefined, null);
    } else if (event.data.type === INCREMENTAL && payload.source === MUTATION_SOURCE) {
      const adds = payload.adds as { parentId?: number; node?: SerializedNode }[] | undefined;
      if (Array.isArray(adds)) {
        for (const add of adds) {
          if (!add || typeof add !== 'object' || !add.node) continue;
          const parentId = typeof add.parentId === 'number' ? add.parentId : null;
          if (add.node.type === TEXT_NODE) {
            // A text node added on its own (a toast whose text is set after the element mounts).
            if (typeof add.node.id === 'number' && parentId !== null) collector.textChanged(add.node.id, parentId, add.node.textContent ?? '');
          } else {
            collector.visit(add.node, parentId);
          }
        }
      }
      const texts = payload.texts as { id?: number; value?: string | null }[] | undefined;
      if (Array.isArray(texts)) {
        for (const change of texts) {
          if (change && typeof change.id === 'number' && typeof change.value === 'string') collector.textMutated(change.id, change.value);
        }
      }
      const attributes = payload.attributes as { id?: number; attributes?: Record<string, unknown> }[] | undefined;
      if (Array.isArray(attributes)) {
        for (const change of attributes) {
          if (change && typeof change.id === 'number' && change.attributes && typeof change.attributes === 'object') {
            collector.attributesChanged(change.id, change.attributes);
          }
        }
      }
    }
  }

  return {
    testIds: collector.testIds.values,
    statusTexts: collector.statusTexts.values,
    headings: collector.headings.values,
    finalPath,
  };
}
