import { gunzipSync } from 'node:zlib';
import { chromium, type Page } from '@playwright/test';
import { canaries } from '../canaries.js';
import { env, percentile, round } from '../env.js';
import type { WorkflowResult } from '../report.js';

async function setMode(mode: 'broken' | 'fixed'): Promise<void> {
  await fetch(`${env.demoUrl}/__demo/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
}

/** The same workflow the E2E suite drives, with the canary secrets typed in. */
async function walk(page: Page): Promise<void> {
  await page.goto(`${env.demoUrl}/login`);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill(canaries.password!);
  await page.getByTestId('sign-in').click();
  await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Address').fill('12 Analytical Engine Way');
  await page.getByLabel('City').fill('London');
  await page.getByLabel('Postal code').fill('N1 9GU');
  await page.getByLabel('Shipping method').selectOption('express');
  await page.getByLabel('Card number').fill(canaries.cardNumber!);
  await page.getByLabel('Expiry').fill(canaries.expiry!);
  await page.getByLabel('CVC').fill(canaries.cvc!);
  await page.getByLabel('Promo code').fill('WELCOME10');
  await page.getByLabel('Save card for next time').check();
  await page.getByTestId('place-order').click();
  await page.waitForTimeout(1500);
}

async function measureOnce(withSdk: boolean, collect?: Buffer[]): Promise<{ taskMs: number; longTasks: number; sessionId: string | null }> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  if (!withSdk) {
    // Replace the SDK with a no-op so the page runs the identical workflow without recording.
    const stub =
      'window.Repro={init(){return{start(){},stop(){},captureException(){},identify(){},annotate(){},flush(){return Promise.resolve()},getSessionId(){return null},isRecording(){return false}}}};';
    await page.route('**/vendor/repro.iife.js', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: stub }),
    );
  }
  if (collect) {
    await page.route('**/v1/ingest**', async (route) => {
      const body = route.request().postDataBuffer();
      if (body) collect.push(body);
      await route.continue();
    });
  }
  await page.addInitScript(() => {
    window.__longTasks = 0;
    try {
      new PerformanceObserver((list) => {
        window.__longTasks = (window.__longTasks ?? 0) + list.getEntries().length;
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // longtask observer unsupported
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await walk(page);
  let sessionId: string | null = null;
  if (withSdk) {
    sessionId = await page.evaluate(() => window.Repro?.getSessionId() ?? null);
    await page.evaluate(async () => {
      await window.Repro?.flush();
      window.Repro?.stop();
      await window.Repro?.flush();
    });
    await page.waitForTimeout(800);
  }
  const metrics = await cdp.send('Performance.getMetrics');
  const task = metrics.metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  const longTasks = await page.evaluate(() => window.__longTasks ?? 0);
  await browser.close();
  return { taskMs: task * 1000, longTasks, sessionId };
}

export async function benchWorkflow(runs = 5): Promise<WorkflowResult> {
  await setMode('broken');
  const withSdk: number[] = [];
  const withoutSdk: number[] = [];
  let longWith = 0;
  let longWithout = 0;
  let sessionId = '';
  let outbound: Buffer[] = [];
  const started = Date.now();
  let durationMs = 0;

  // Warm both variants once so JIT and caches do not favour the second variant.
  await measureOnce(false);
  await measureOnce(true);

  for (let i = 0; i < runs; i += 1) {
    const a = await measureOnce(false);
    withoutSdk.push(a.taskMs);
    longWithout += a.longTasks;
    const collect: Buffer[] = [];
    const t0 = Date.now();
    const b = await measureOnce(true, collect);
    durationMs = Date.now() - t0;
    withSdk.push(b.taskMs);
    longWith += b.longTasks;
    if (b.sessionId) {
      sessionId = b.sessionId;
      outbound = collect;
    }
  }
  void started;

  const decoded = outbound.map((buf) => {
    try {
      return gunzipSync(buf).toString('utf8');
    } catch {
      return buf.toString('utf8');
    }
  });
  const all = decoded.join('\n');
  let events = 0;
  let rrwebEvents = 0;
  let sampleBatch: unknown = null;
  for (const text of decoded) {
    try {
      const batch = JSON.parse(text) as { events: { type: string }[]; meta?: unknown };
      events += batch.events.length;
      rrwebEvents += batch.events.filter((e) => e.type === 'rrweb').length;
      if (!sampleBatch && batch.meta) sampleBatch = batch;
    } catch {
      // not JSON
    }
  }
  const leaked = Object.entries(canaries)
    .filter(([, value]) => all.includes(value))
    .map(([name]) => name);

  const medianWith = percentile(withSdk, 50);
  const medianWithout = percentile(withoutSdk, 50);
  return {
    runs,
    taskDurationMsWithSdk: withSdk.map((v) => round(v)),
    taskDurationMsWithoutSdk: withoutSdk.map((v) => round(v)),
    medianWithSdkMs: round(medianWith),
    medianWithoutSdkMs: round(medianWithout),
    addedMainThreadMs: round(medianWith - medianWithout),
    longTasksWithSdk: longWith,
    longTasksWithoutSdk: longWithout,
    payload: {
      batches: outbound.length,
      compressedBytes: outbound.reduce((n, b) => n + b.length, 0),
      decompressedBytes: decoded.reduce((n, t) => n + Buffer.byteLength(t), 0),
      events,
      rrwebEvents,
      durationMs,
    },
    redaction: { canaries: Object.keys(canaries).length, leaked },
    sessionId,
    sampleBatch,
  };
}
