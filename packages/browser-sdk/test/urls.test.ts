/** URL sanitisation on navigation and network events, and what network capture leaves out. */
import { beforeEach, describe, expect, it } from 'vitest';
import { CANARIES } from './canaries.js';
import { ENDPOINT, installPageFetch, installPageXhr, makeClient, ofType, resetDom, tick } from './helpers.js';

const QS = CANARIES.CANARY_QS_;

describe('navigation capture', () => {
  beforeEach(() => resetDom());

  it('records load, push, replace, pop and hash navigations with sanitised urls', async () => {
    const harness = makeClient({}, { rrweb: false });
    document.title = 'Home';
    harness.client.start();
    history.pushState({}, '', `/checkout?token=${QS}&step=2`);
    history.replaceState({}, '', `/checkout?api_key=${QS}&step=3#id_token=${QS}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new Event('hashchange'));
    await harness.client.flush();
    expect(harness.fetch.errors).toEqual([]);
    const navs = ofType(harness.fetch.events(), 'navigation');
    expect(navs.map((n) => n.data.kind)).toEqual(['load', 'push', 'replace', 'pop', 'hash']);
    expect(navs[0]?.data).toMatchObject({ url: 'http://localhost:3000/', title: 'Home' });
    expect(navs[1]?.data.url).toBe('http://localhost:3000/checkout?token=%5Bredacted%5D&step=2');
    expect(navs[2]?.data.url).toBe('http://localhost:3000/checkout?api_key=%5Bredacted%5D&step=3#id_token=%5Bredacted%5D');
    expect(harness.fetch.text()).not.toContain(QS);
  });

  it('restores history methods on stop', () => {
    const harness = makeClient({}, { rrweb: false });
    const push = history.pushState;
    harness.client.start();
    expect(history.pushState).not.toBe(push);
    harness.client.stop();
    expect(history.pushState).toBe(push);
  });
});

describe('network capture', () => {
  beforeEach(() => resetDom());

  it('records fetch shape with a sanitised url and path, never headers or bodies', async () => {
    installPageFetch('{"secret":"' + CANARIES.CANARY_RESPONSE_SECRET_ + '"}', 201);
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    await window.fetch(`/api/orders?access_token=${QS}&page=2`, {
      method: 'post',
      headers: { authorization: `Bearer ${CANARIES.CANARY_BEARER_}` },
      body: CANARIES.CANARY_REQUEST_BODY_,
    });
    await window.fetch(new URL(`https://api.example.com/v2/items?sig=${QS}`));
    await harness.client.flush();
    expect(harness.fetch.errors).toEqual([]);
    const events = ofType(harness.fetch.events(), 'network');
    expect(events).toHaveLength(2);
    expect(events[0]?.data).toMatchObject({
      kind: 'fetch',
      method: 'POST',
      url: 'http://localhost:3000/api/orders?access_token=%5Bredacted%5D&page=2',
      path: '/api/orders?access_token=%5Bredacted%5D&page=2',
      status: 201,
      ok: true,
    });
    expect(events[1]?.data).toMatchObject({ method: 'GET', url: 'https://api.example.com/v2/items?sig=%5Bredacted%5D' });
    expect(events[0]?.data.requestId).toMatch(/^[0-9a-f]{12}$/);
    expect(events[0]?.data.durationMs).toBeGreaterThanOrEqual(0);
    const text = harness.fetch.text();
    for (const canary of [QS, CANARIES.CANARY_BEARER_, CANARIES.CANARY_REQUEST_BODY_, CANARIES.CANARY_RESPONSE_SECRET_]) {
      expect(text).not.toContain(canary);
    }
  });

  it('records a failed fetch with a scrubbed error and null status', async () => {
    window.fetch = (async () => {
      throw new TypeError(`Failed to fetch token=${QS}`);
    }) as typeof fetch;
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    await expect(window.fetch('/api/down')).rejects.toThrow('Failed to fetch');
    await harness.client.flush();
    const [event] = ofType(harness.fetch.events(), 'network');
    expect(event?.data).toMatchObject({ status: null, ok: false, error: 'Failed to fetch token=[redacted]' });
  });

  it('records XHR requests with a sanitised url', async () => {
    installPageXhr(404);
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    const xhr = new XMLHttpRequest();
    const done = new Promise<void>((resolve) => xhr.addEventListener('loadend', () => resolve()));
    xhr.open('GET', `/api/me?session=${QS}`);
    xhr.send();
    await done;
    await tick();
    await harness.client.flush();
    const [event] = ofType(harness.fetch.events(), 'network');
    expect(event?.data).toMatchObject({
      kind: 'xhr',
      method: 'GET',
      path: '/api/me?session=%5Bredacted%5D',
      status: 404,
      ok: false,
    });
    expect(harness.fetch.text()).not.toContain(QS);
  });

  it('does not record its own uploads to the ingest endpoint', async () => {
    installPageFetch('{}');
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    await window.fetch(`${ENDPOINT}/v1/ingest`, { method: 'POST' });
    await window.fetch('/api/other');
    await harness.client.flush();
    const events = ofType(harness.fetch.events(), 'network');
    expect(events.map((e) => e.data.path)).toEqual(['/api/other']);
  });

  it('can be turned off, and restores fetch on stop', async () => {
    installPageFetch('{}');
    const pageFetch = window.fetch;
    const harness = makeClient({ captureNetwork: false }, { rrweb: false });
    harness.client.start();
    expect(window.fetch).toBe(pageFetch);
    await window.fetch('/api/other');
    await harness.client.flush();
    expect(ofType(harness.fetch.events(), 'network')).toHaveLength(0);

    const on = makeClient({}, { rrweb: false });
    on.client.start();
    expect(window.fetch).not.toBe(pageFetch);
    on.client.stop();
    expect(window.fetch).toBe(pageFetch);
  });
});
