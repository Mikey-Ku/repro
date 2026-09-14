import { describe, expect, it } from 'vitest';
import { extractDomMarkers, type RecordedEvent } from '../src/index.js';

/** Minimal rrweb serialized-node builders. Shapes follow rrweb 2.x (see test/rrweb.test.ts). */
let nextId = 100;
const el = (tagName: string, attributes: Record<string, unknown> = {}, childNodes: unknown[] = [], id = nextId++) => ({ type: 2, id, tagName, attributes, childNodes });
const txt = (textContent: string, id = nextId++) => ({ type: 3, id, textContent });

const rr = (seq: number, type: number, data: unknown): RecordedEvent => ({ seq, ts: 1_700_000_000_000 + seq, type: 'rrweb', data: { type, timestamp: seq, data } });
const snapshot = (seq: number, root: unknown): RecordedEvent => rr(seq, 2, { node: { type: 0, id: 1, childNodes: [root] }, initialOffset: { left: 0, top: 0 } });
const mutation = (seq: number, patch: Record<string, unknown>): RecordedEvent => rr(seq, 3, { source: 0, adds: [], removes: [], texts: [], attributes: [], ...patch });
const nav = (seq: number, url: string): RecordedEvent => ({ seq, ts: 1_700_000_000_000 + seq, type: 'navigation', data: { url, kind: 'push' } });

describe('extractDomMarkers', () => {
  it('collects test ids, live-region text and headings from a full snapshot', () => {
    const page = el('html', {}, [
      el('body', {}, [
        el('h1', {}, [txt('  Checkout\n  ')]),
        el('div', { 'data-testid': 'cart' }, [el('h2', {}, [txt('Your items')]), el('span', { 'data-testid': 'cart-total' }, [txt('$12')])]),
        el('div', { role: 'status' }, [txt('Order '), el('strong', {}, [txt('placed')])]),
        el('p', { 'aria-live': 'polite' }, [txt('Saved')]),
        el('p', { 'aria-live': 'off' }, [txt('not live')]),
        el('h4', {}, [txt('too deep')]),
      ]),
    ]);
    const markers = extractDomMarkers([snapshot(0, page)]);
    expect(markers).toEqual({
      testIds: ['cart', 'cart-total'],
      statusTexts: ['Order placed', 'Saved'],
      headings: ['Checkout', 'Your items'],
      finalPath: null,
    });
  });

  it('picks up mutation adds, including a text node added under an existing live region', () => {
    const toast = el('div', { role: 'status' }, [], 50);
    const events = [
      snapshot(0, el('body', {}, [toast])),
      mutation(1, { adds: [{ parentId: 50, nextId: null, node: txt('Order placed', 51) }] }),
      mutation(2, { adds: [{ parentId: 2, nextId: null, node: el('section', { 'data-testid': 'order-confirmation' }, [el('h2', {}, [txt('Thank you')])]) }] }),
    ];
    const markers = extractDomMarkers(events);
    expect(markers.testIds).toEqual(['order-confirmation']);
    expect(markers.statusTexts).toEqual(['Order placed']);
    expect(markers.headings).toEqual(['Thank you']);
  });

  it('follows text and attribute mutations on known nodes', () => {
    const status = el('div', { role: 'status' }, [txt('Saving', 61)], 60);
    const plain = el('div', {}, [txt('Ready', 71)], 70);
    const events = [
      snapshot(0, el('body', {}, [status, plain])),
      mutation(1, { texts: [{ id: 61, value: 'Saved' }] }),
      mutation(2, { attributes: [{ id: 70, attributes: { 'data-testid': 'ready-banner', 'aria-live': 'assertive' } }] }),
    ];
    const markers = extractDomMarkers(events);
    expect(markers.statusTexts).toEqual(['Saving', 'Saved', 'Ready']);
    expect(markers.testIds).toEqual(['ready-banner']);
  });

  it('takes the final path from the last navigation, whatever order events arrived in', () => {
    const events = [nav(5, 'http://shop.local/checkout/confirmation?order=1'), nav(1, 'http://shop.local/checkout'), snapshot(0, el('body'))];
    expect(extractDomMarkers(events).finalPath).toBe('/checkout/confirmation');
    expect(extractDomMarkers([nav(0, '/relative?x=1')]).finalPath).toBe('/relative');
  });

  it('deduplicates and ignores events that carry no DOM', () => {
    const events: RecordedEvent[] = [
      snapshot(0, el('body', {}, [el('a', { 'data-testid': 'nav-home' }), el('a', { 'data-testid': 'nav-home' })])),
      rr(1, 3, { source: 1, positions: [] }),
      rr(2, 4, { href: 'http://x/', width: 1, height: 1 }),
      { seq: 3, ts: 3, type: 'console', data: { level: 'error', args: ['x'] } },
      rr(4, 3, null),
    ];
    expect(extractDomMarkers(events)).toEqual({ testIds: ['nav-home'], statusTexts: [], headings: [], finalPath: null });
    expect(extractDomMarkers([])).toEqual({ testIds: [], statusTexts: [], headings: [], finalPath: null });
  });

  it('does not mutate its input', () => {
    const events = [nav(1, 'http://x/b'), nav(0, 'http://x/a')];
    const copy = structuredClone(events);
    extractDomMarkers(events);
    expect(events).toEqual(copy);
  });
});
