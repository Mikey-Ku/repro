/**
 * Record the committed generator fixtures from real demo sessions.
 *
 * Drives three variants of the checkout workflow against the running demo (broken mode),
 * waits for each session to be processed, exports its events and metadata from the ingest
 * API, and writes scripts/bench/fixtures/<name>.json. Re-run when the demo or the SDK changes.
 *
 *   pnpm --filter @repro/bench exec tsx record-fixtures.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { canaries } from './canaries.js';
import { env } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const internal = { 'x-repro-internal-token': env.internalToken, 'content-type': 'application/json' };

declare global {
  interface Window {
    Repro: { getSessionId(): string | null; flush(): Promise<void>; stop(): void };
  }
}

interface Variant {
  name: string;
  description: string;
  run: (page: Page) => Promise<void>;
}

async function login(page: Page, submitWithEnter: boolean): Promise<void> {
  await page.goto(`${env.demoUrl}/login`);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill(canaries.password!);
  if (submitWithEnter) await page.getByLabel('Password').press('Enter');
  else await page.getByTestId('sign-in').click();
  await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  await page.getByTestId('order-summary').getByText('Field notebook').waitFor();
}

async function fillCheckout(page: Page, options: { shipping: 'standard' | 'express'; promo: string | null; saveCard: boolean }): Promise<void> {
  await page.getByLabel('Address').fill('12 Analytical Engine Way');
  await page.getByLabel('City').fill('London');
  await page.getByLabel('Postal code').fill('N1 9GU');
  if (options.shipping === 'express') await page.getByLabel('Shipping method').selectOption('express');
  await page.getByLabel('Card number').fill(canaries.cardNumber!);
  await page.getByLabel('Expiry').fill(canaries.expiry!);
  await page.getByLabel('CVC').fill(canaries.cvc!);
  if (options.promo) await page.getByLabel('Promo code').fill(options.promo);
  if (options.saveCard) await page.getByLabel('Save card for next time').check();
  const response = page.waitForResponse((r) => r.url().includes('/api/orders'));
  const error = page.waitForEvent('pageerror', { timeout: 15_000 }).catch(() => null);
  await page.getByTestId('place-order').click();
  await response;
  await error;
}

const variants: Variant[] = [
  {
    name: 'checkout-express-promo',
    description: 'Mouse-driven login, express shipping, promo code, save card.',
    run: async (page) => {
      await login(page, false);
      await fillCheckout(page, { shipping: 'express', promo: 'WELCOME10', saveCard: true });
    },
  },
  {
    name: 'checkout-standard',
    description: 'Mouse-driven login, default shipping, no promo, no saved card.',
    run: async (page) => {
      await login(page, false);
      await fillCheckout(page, { shipping: 'standard', promo: null, saveCard: false });
    },
  },
  {
    name: 'checkout-enter-key-login',
    description: 'Login submitted with the Enter key, express shipping.',
    run: async (page) => {
      await login(page, true);
      await fillCheckout(page, { shipping: 'express', promo: null, saveCard: true });
    },
  },
];

async function main(): Promise<void> {
  await fetch(`${env.demoUrl}/__demo/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'broken' }) });
  const projectId = ((await (await fetch(`${env.ingestUrl}/api/projects/by-slug/demo`, { headers: internal })).json()) as { id: string }).id;
  const browser = await chromium.launch();
  const outDir = path.join(here, 'fixtures');
  fs.mkdirSync(outDir, { recursive: true });

  for (const variant of variants) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await variant.run(page);
    const sessionId = await page.evaluate(() => window.Repro.getSessionId());
    await page.evaluate(async () => {
      await window.Repro.flush();
      window.Repro.stop();
      await window.Repro.flush();
    });
    await page.waitForTimeout(1000);
    await context.close();
    if (!sessionId) throw new Error(`no session id for ${variant.name}`);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const detail = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}`, { headers: internal })).json()) as { session: { status: string }; incidents: unknown[] };
      if (detail.session.status === 'completed' && detail.incidents.length) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const exported = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}/events`, { headers: internal })).json()) as { events: unknown[]; meta: unknown };
    const text = JSON.stringify(exported);
    for (const [key, value] of Object.entries(canaries)) {
      if (text.includes(value)) throw new Error(`fixture ${variant.name} would contain canary ${key}; refusing to write it`);
    }
    const fixture = {
      name: variant.name,
      description: variant.description,
      recordedFrom: sessionId,
      expectations: [{ kind: 'visible', testId: 'order-confirmation' }],
      batch: { meta: exported.meta, events: exported.events },
    };
    fs.writeFileSync(path.join(outDir, `${variant.name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote ${variant.name}: ${exported.events.length} events`);
    await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}`, { method: 'DELETE', headers: internal });
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
