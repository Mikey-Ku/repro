import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { GeneratedTest, Incident, ReproductionRun, SessionSummary } from '@repro/contracts';
import { api, persistedSessionText, projectBySlug, setDemoMode, waitFor } from '../support/api.js';
import { canaries, findCanaries } from '../support/canaries.js';
import { env } from '../support/env.js';

declare global {
  interface Window {
    Repro: {
      getSessionId(): string | null;
      flush(): Promise<void>;
      stop(): void;
    };
  }
}

/**
 * The complete product journey, in order:
 * 1. A user hits the intentionally broken checkout while the SDK records.
 * 2. Nothing sensitive leaves the browser.
 * 3. The server ingests, completes and processes the session.
 * 4. Nothing sensitive is persisted.
 * 5. The dashboard lists the session, replays it and shows the error timeline.
 * 6. A Playwright test is generated from the recording.
 * 7. The test fails against broken mode for the intended reason.
 * 8. The same test passes against fixed mode.
 */
test.describe.serial('Repro end to end', () => {
  const outbound: Buffer[] = [];
  let projectId = '';
  let sessionId = '';
  let generatedTestId = '';

  const decode = (buffer: Buffer): string => {
    try {
      return gunzipSync(buffer).toString('utf8');
    } catch {
      return buffer.toString('utf8');
    }
  };

  const walkBrokenCheckout = async (page: Page): Promise<void> => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByLabel('Password').fill(canaries.password!);
    await page.getByTestId('sign-in').click();

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByTestId('order-summary')).toContainText('Field notebook');
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
  };

  test('1. the SDK records a user hitting the broken checkout', async ({ page }) => {
    await setDemoMode('broken');
    await page.route('**/v1/ingest**', async (route) => {
      const body = route.request().postDataBuffer();
      if (body) outbound.push(body);
      await route.continue();
    });

    await walkBrokenCheckout(page);

    // Broken mode: the button never recovers and no confirmation appears.
    await expect(page.getByTestId('place-order')).toHaveText(/Placing order/);
    await expect(page.getByTestId('place-order')).toBeDisabled();
    await expect(page.getByTestId('order-confirmation')).toHaveCount(0);

    sessionId = (await page.evaluate(() => window.Repro.getSessionId())) ?? '';
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    await page.evaluate(async () => {
      await window.Repro.flush();
      window.Repro.stop();
      await window.Repro.flush();
    });
    await page.waitForTimeout(1500);
    expect(outbound.length, 'the SDK uploaded at least one batch').toBeGreaterThan(0);
  });

  test('2. no canary secret leaves the browser', async () => {
    const payloads = outbound.map(decode);
    const all = payloads.join('\n');
    expect(all.length).toBeGreaterThan(1000);
    // Sanity: the payload really is the recording of this session.
    expect(all).toContain(sessionId);
    expect(all).toContain('toUpperCase');
    expect(all).toContain('"masked":true');
    // The core guarantee.
    expect(findCanaries(all)).toEqual([]);
    // Plain-text fields that are not secrets are captured, so the test generator can replay them.
    expect(all).toContain('Ada Lovelace');
    expect(all).toContain('WELCOME10');
    // The query-string token was stripped rather than the whole URL being dropped.
    expect(all).toMatch(/\/checkout\?ref=email&token=%5Bredacted%5D/);
  });

  test('3. the server ingests, completes and processes the session', async () => {
    projectId = (await projectBySlug('demo')).id;
    const detail = await waitFor(
      async () => {
        const d = await api<{ session: SessionSummary; incidents: Incident[] }>(`/api/projects/${projectId}/sessions/${sessionId}`);
        return d.session.status === 'completed' && d.incidents.length > 0 ? d : null;
      },
      { timeoutMs: 60_000, label: 'session completed and processed' },
    );
    expect(detail.session.errorCount).toBeGreaterThanOrEqual(1);
    expect(detail.session.initialRoute).toBe('/login');
    expect(detail.session.routes).toContain('/checkout');
    expect(detail.incidents[0]!.kind).toBe('exception');
    expect(detail.incidents[0]!.message).toContain('toUpperCase');
  });

  test('4. no canary secret is persisted', async () => {
    const persisted = await persistedSessionText(sessionId);
    expect(persisted).toContain('toUpperCase');
    expect(findCanaries(persisted)).toEqual([]);
  });

  test('5. the dashboard lists the session, replays it and shows the error', async ({ page }) => {
    await page.goto(`${env.webUrl}/projects/demo/sessions?hasErrors=true`);
    const row = page.locator(`a[href*="${sessionId}"]`).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}`));

    // Replay: rrweb-player mounts a sandboxed iframe and rebuilds the recorded DOM inside it.
    const replayFrame = page.frameLocator('.rr-player iframe').first();
    await expect(replayFrame.locator('body')).toBeAttached({ timeout: 30_000 });
    await expect(replayFrame.getByText(/Northwind|Sign in|Checkout/).first()).toBeAttached({ timeout: 30_000 });
    // The replayed DOM must not carry the recorded secrets either.
    const replayHtml = await replayFrame.locator('html').innerHTML();
    expect(findCanaries(replayHtml)).toEqual([]);

    // Timeline shows the recorded exception and the successful request that preceded it.
    await expect(page.getByText(/TypeError/).first()).toBeVisible();
    await expect(page.getByText(/POST \/api\/orders/).first()).toBeVisible();
    await page.getByRole('button', { name: /jump to first error/i }).click();
  });

  test('6. a readable Playwright test is generated from the recording', async ({ page }) => {
    await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`);
    await page.getByRole('tab', { name: /test/i }).click();
    await page.getByLabel(/test id/i).fill('order-confirmation');
    await page.getByRole('button', { name: /generate playwright test/i }).click();

    const tests = await waitFor(
      async () => {
        const list = await api<GeneratedTest[]>(`/api/projects/${projectId}/sessions/${sessionId}/tests`);
        return list.length ? list : null;
      },
      { label: 'generated test' },
    );
    const generated = tests[0]!;
    generatedTestId = generated.id;
    expect(generated.code).toContain("import { test, expect } from '@playwright/test'");
    expect(generated.code).toContain("page.goto('/login')");
    expect(generated.code).toContain("getByLabel('Card number')");
    expect(generated.code).toContain("getByRole('button', { name: 'Place order' })");
    expect(generated.code).toContain("selectOption('express')");
    expect(generated.code).toContain("getByTestId('order-confirmation')");
    expect(generated.code).toContain('pageErrors');
    expect(findCanaries(generated.code)).toEqual([]);
    expect(generated.code).toContain(sessionId);

    await expect(page.locator('pre, code').filter({ hasText: 'order-confirmation' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /copy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /download/i })).toBeVisible();
  });

  const runAndWait = async (mode: 'broken' | 'fixed'): Promise<ReproductionRun> => {
    const created = await api<ReproductionRun>(`/api/projects/${projectId}/tests/${generatedTestId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
    return waitFor(
      async () => {
        const run = await api<ReproductionRun>(`/api/projects/${projectId}/runs/${created.id}`);
        return ['passed', 'failed', 'error', 'timeout'].includes(run.status) ? run : null;
      },
      { timeoutMs: 150_000, intervalMs: 1000, label: `reproduction run (${mode})` },
    );
  };

  test('7. the generated test fails against broken mode for the intended reason', async ({ page }) => {
    const run = await runAndWait('broken');
    expect(run.status, run.failureMessage ?? run.logs ?? '').toBe('failed');
    expect(run.failureMessage ?? '').toMatch(/order-confirmation|toUpperCase|uncaught errors/);
    expect(run.artifacts.map((a) => a.name)).toContain('trace.zip');

    await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`);
    await page.getByRole('tab', { name: /runs/i }).click();
    await expect(page.getByText(/failed/i).first()).toBeVisible();
    await expect(page.getByText(/broken/i).first()).toBeVisible();
  });

  test('8. the same test passes against fixed mode', async ({ page }) => {
    const run = await runAndWait('fixed');
    expect(run.status, run.failureMessage ?? run.logs ?? '').toBe('passed');

    await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`);
    await page.getByRole('tab', { name: /runs/i }).click();
    await expect(page.getByText(/passed/i).first()).toBeVisible();
    await setDemoMode('broken');
  });
});
