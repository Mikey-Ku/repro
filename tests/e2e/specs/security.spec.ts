import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { IngestBatch } from '@repro/contracts';
import { api, projectBySlug, waitFor } from '../support/api.js';
import { env } from '../support/env.js';

declare global {
  interface Window {
    __xss?: unknown;
  }
}

/**
 * Recorded content is attacker-controlled: any page that embeds the SDK can emit
 * console output, error messages and URLs shaped like HTML. The dashboard must render
 * them as inert text.
 */
test('XSS-shaped recorded content is rendered as text in the dashboard', async ({ page }) => {
  const sessionId = randomUUID();
  const now = Date.now();
  const payload = '<img src=x onerror="window.__xss=1">';
  const script = '<script>window.__xss=2</script>';
  const batch: IngestBatch = {
    v: 1,
    sessionId,
    batchSeq: 0,
    sentAt: now,
    final: true,
    meta: {
      startedAt: now - 5000,
      sdkVersion: 'e2e',
      browser: { name: 'Chrome', version: '1', userAgent: `ua ${payload}` },
      viewport: { width: 800, height: 600 },
      page: { url: `http://localhost:4100/${encodeURIComponent(payload)}`, title: script },
    },
    events: [
      { seq: 0, ts: now - 5000, type: 'navigation', data: { url: `http://localhost:4100/x?q=${encodeURIComponent(payload)}`, kind: 'load' } },
      { seq: 1, ts: now - 4000, type: 'console', data: { level: 'error', args: [payload, script] } },
      { seq: 2, ts: now - 3000, type: 'network', data: { kind: 'fetch', method: 'GET', url: `http://localhost:4100/api/${payload}`, path: `/api/${payload}`, status: 500, ok: false, durationMs: 12, requestId: 'r1' } },
      { seq: 3, ts: now - 2000, type: 'error', data: { kind: 'exception', name: script, message: `Boom ${payload}`, stack: `Error: ${script}\n at ${payload}`, handled: false } },
      { seq: 4, ts: now - 1000, type: 'click', data: { target: { tag: 'button', text: payload, accessibleName: script, sensitive: false } } },
    ],
  };
  const res = await fetch(`${env.ingestUrl}/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repro-key': env.demoProjectKey },
    body: JSON.stringify(batch),
  });
  expect(res.status, await res.text()).toBe(200);

  const projectId = (await projectBySlug('demo')).id;
  await waitFor(async () => {
    const d = await api<{ incidents: unknown[] }>(`/api/projects/${projectId}/sessions/${sessionId}`);
    return d.incidents.length ? d : null;
  }, { label: 'session processed' });

  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  const pages: [string, RegExp][] = [
    [`${env.webUrl}/projects/demo/sessions/${sessionId}`, /img src=x|Boom/],
    // The list shows the route, which is URL-encoded by the SDK contract, so it is inert by construction.
    [`${env.webUrl}/projects/demo/sessions`, /%3Cimg%20src%3Dx/],
    [`${env.webUrl}/projects/demo/incidents`, /Boom/],
  ];
  for (const [url, expected] of pages) {
    await page.goto(url);
    await expect(page.getByText(expected).first()).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  }

  // The evidence tab renders the stack trace and console args too.
  await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`);
  await page.getByRole('tab', { name: /evidence/i }).click();
  await expect(page.getByRole('tabpanel').getByText(/Boom/).first()).toBeVisible();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});

test('the ingest API rejects a foreign key, a malformed batch and an oversize body', async () => {
  const bad = await fetch(`${env.ingestUrl}/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repro-key': 'rp_not_a_real_key_000000000000000' },
    body: JSON.stringify({ v: 1 }),
  });
  expect(bad.status).toBe(401);

  const malformed = await fetch(`${env.ingestUrl}/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repro-key': env.demoProjectKey },
    body: JSON.stringify({ v: 1, sessionId: randomUUID(), batchSeq: 0, sentAt: Date.now(), events: [{ seq: 0, ts: 1, type: 'evil', data: {} }] }),
  });
  expect(malformed.status).toBe(400);
  const body = (await malformed.json()) as { ok: boolean; error: { code: string } };
  expect(body.ok).toBe(false);
  expect(body.error.code).toBe('validation_failed');

  const huge = await fetch(`${env.ingestUrl}/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repro-key': env.demoProjectKey },
    body: JSON.stringify({ v: 1, sessionId: randomUUID(), batchSeq: 0, sentAt: Date.now(), events: [], pad: 'x'.repeat(2_100_000) }),
  });
  expect(huge.status).toBe(413);
});
