import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { DiagnosticFinding, GeneratedTest, Incident, ReproductionRun, SessionSummary } from '@repro/contracts';
import { api, projectBySlug, setDemoMode, waitFor } from '../support/api.js';
import { findCanaries } from '../support/canaries.js';
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

/** Typed by the test only; it exists nowhere in the demo's code. It must never leave the browser. */
const SETTINGS_PASSWORD = 'CANARY_SETTINGS_PW_2fa9';

interface SessionDetail {
  session: SessionSummary;
  incidents: Incident[];
  findings: DiagnosticFinding[];
}

interface ExampleCase {
  slug: 'settings' | 'inbox' | 'orders' | 'signup';
  path: string;
  successTestId: string;
  /** Drives the UI the way a user would, ending on the broken behaviour. */
  walk(page: Page): Promise<void>;
  /** What broken mode looks like once the walk is over. */
  assertBroken(page: Page, pageErrors: string[]): Promise<void>;
  /** Extra checks on the decoded SDK uploads. */
  assertPayload?(all: string): void;
  /** Extra checks on the processed session and its deterministic evidence summary. */
  assertProcessed?(detail: SessionDetail): void;
  /** Why the generated test should fail on broken mode. */
  brokenFailure: RegExp;
}

const EXAMPLES: ExampleCase[] = [
  {
    slug: 'settings',
    path: '/examples/settings',
    successTestId: 'settings-saved',
    async walk(page) {
      await page.goto('/examples/settings');
      await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
      await page.getByLabel('Display name').fill('Ada King');
      await page.getByLabel('Bio').fill('Countess of Lovelace. Writes about the Analytical Engine.');
      await page.getByLabel('Dark').check();
      await page.getByLabel('Weekly digest').check();
      await page.getByLabel('Timezone').selectOption('Asia/Tokyo');
      await page.getByLabel('Current password').fill(SETTINGS_PASSWORD);
      await page.getByLabel('New password').fill(`${SETTINGS_PASSWORD}_next`);
      const saveResponse = page.waitForResponse((response) => response.url().includes('/api/examples/settings'));
      await page.getByTestId('save-settings').click();
      expect((await saveResponse).status()).toBe(415);
    },
    async assertBroken(page, pageErrors) {
      // The save failed, nothing on the page says so, and nothing was thrown.
      await expect(page.getByTestId('save-settings')).toBeEnabled();
      await expect(page.getByTestId('settings-saved')).toHaveCount(0);
      await expect(page.getByTestId('settings-error')).toBeHidden();
      await expect(page.getByLabel('Display name')).toHaveValue('Ada King');
      expect(pageErrors).toEqual([]);
    },
    assertPayload(all) {
      expect(all).not.toContain(SETTINGS_PASSWORD);
      expect(all).toContain('Ada King');
      expect(all).toContain('/api/examples/settings');
      expect(all).toContain('"status":415');
      expect(all).toContain('Save failed');
    },
    assertProcessed({ session, incidents, findings }) {
      expect(session.errorCount).toBe(0);
      expect(session.networkFailureCount).toBeGreaterThanOrEqual(1);
      // No uncaught error, so the console.error is the incident; the 415 shows up as a failed request.
      expect(incidents.map((i) => i.kind)).toContain('console');
      const evidence = findings[0]!.evidence!;
      expect(evidence.earliestError).toBeNull();
      expect(evidence.failedRequests.map((r) => [r.method, r.path, r.status])).toContainEqual(['PUT', '/api/examples/settings', 415]);
      expect(evidence.gaps).toContain('No uncaught error was recorded; the failure may be visual only.');
    },
    brokenFailure: /PUT \/api\/examples\/settings should succeed|settings-saved/,
  },
  {
    slug: 'inbox',
    path: '/examples/inbox',
    successTestId: 'message-sent',
    async walk(page) {
      await page.goto('/examples/inbox');
      await expect(page.getByTestId('message-list').getByRole('listitem')).toHaveCount(4);
      // Client-side routing: the URL changes without a reload.
      await page.getByRole('link', { name: 'Archive' }).click();
      await expect(page).toHaveURL(/\/examples\/inbox\/archive$/);
      await expect(page.getByTestId('message-list').getByRole('listitem')).toHaveCount(2);

      await page.getByTestId('compose').click();
      await expect(page.getByTestId('compose-dialog')).toBeVisible();
      await page.getByLabel('To').fill('grace@example.com');
      await page.getByLabel('Body').fill('The dotted A5 is back in stock at Northwind.');
      await page.getByLabel('Subject').fill('Re: Notebook recommendations?');
      const sendResponse = page.waitForResponse((response) => response.url().includes('/api/examples/inbox/messages') && response.request().method() === 'POST');
      const pageError = page.waitForEvent('pageerror', { timeout: 15_000 }).catch(() => null);
      // Enter in Subject submits the compose form.
      await page.getByLabel('Subject').press('Enter');
      expect((await sendResponse).status()).toBe(200);
      await pageError;
    },
    async assertBroken(page, pageErrors) {
      // The server accepted the message, then the handler threw and the dialog never closed.
      await expect(page.getByTestId('compose-dialog')).toBeVisible();
      await expect(page.getByTestId('message-sent')).toHaveCount(0);
      await expect(page).toHaveURL(/\/examples\/inbox\/archive$/);
      expect(pageErrors.join('\n')).toMatch(/TypeError.*close/);
    },
    assertPayload(all) {
      expect(all).toContain('/examples/inbox/archive');
      expect(all).toContain('Re: Notebook recommendations?');
      expect(all).toContain("reading 'close'");
    },
    assertProcessed({ session, incidents }) {
      expect(session.errorCount).toBeGreaterThanOrEqual(1);
      expect(session.routes).toContain('/examples/inbox/archive');
      expect(incidents[0]!.message).toContain("reading 'close'");
    },
    brokenFailure: /message-sent|close|uncaught errors/,
  },
  {
    slug: 'orders',
    path: '/examples/orders',
    successTestId: 'orders-table',
    async walk(page) {
      await page.goto('/examples/orders');
      await expect(page.getByTestId('orders-table')).toBeVisible();
      await expect(page.getByTestId('order-row')).toHaveCount(8);
      // Enter submits the search form; the results include an order that is still pending pricing.
      await page.getByLabel('Search orders').fill('Hopper');
      await page.getByLabel('Search orders').press('Enter');
      await expect(page.getByTestId('order-row')).toHaveCount(3);
      await expect(page.getByTestId('orders-table')).toContainText('Pending pricing');
      const pageError = page.waitForEvent('pageerror', { timeout: 15_000 }).catch(() => null);
      await page.getByRole('button', { name: 'Total', exact: true }).click();
      await pageError;
    },
    async assertBroken(page, pageErrors) {
      // The sort threw on the null total; the spinner replaced the table and never left.
      await expect(page.getByTestId('orders-loading')).toBeVisible();
      await expect(page.getByTestId('orders-table')).toHaveCount(0);
      expect(pageErrors.join('\n')).toMatch(/TypeError.*toFixed/);
    },
    assertPayload(all) {
      expect(all).toContain('Hopper');
      expect(all).toContain('toFixed');
    },
    assertProcessed({ session, incidents }) {
      expect(session.errorCount).toBeGreaterThanOrEqual(1);
      expect(incidents[0]!.kind).toBe('exception');
      expect(incidents[0]!.message).toContain('toFixed');
    },
    brokenFailure: /orders-table|toFixed|uncaught errors/,
  },
  {
    slug: 'signup',
    path: '/examples/signup',
    successTestId: 'welcome',
    async walk(page) {
      await page.goto('/examples/signup');
      await page.getByLabel('Email').fill('ada@example.com');
      await page.getByLabel('Password').fill('TEST_SIGNUP_PASSWORD_9c1d');
      await page.getByTestId('step1-next').click();
      await expect(page.getByTestId('step-2')).toBeVisible();
      await page.getByLabel('Full name').fill('Ada Lovelace');
      await page.getByLabel('Role').selectOption('engineer');
      await page.getByLabel('I agree to the terms').check();
      await page.getByTestId('step2-next').click();
      await expect(page.getByTestId('step-3')).toBeVisible();
      await page.getByLabel('Verification code').fill('482913');
      // Finish looks disabled and stays that way. A user clicks it anyway, and so does this test:
      // force skips Playwright's enabled check, the button is not natively disabled, so the click is recorded.
      await page.getByTestId('finish').click({ force: true });
    },
    async assertBroken(page, pageErrors) {
      // Nothing happened: no error, no request, no welcome. Only the button's state gives it away.
      await expect(page.getByTestId('finish')).toBeDisabled();
      await expect(page.getByTestId('welcome')).toHaveCount(0);
      await expect(page.getByTestId('step-3')).toBeVisible();
      expect(pageErrors).toEqual([]);
    },
    assertPayload(all) {
      expect(all).not.toContain('482913');
      expect(all).not.toContain('TEST_SIGNUP_PASSWORD_9c1d');
      expect(all).toContain('Ada Lovelace');
      expect(all).toContain('code incomplete');
      // The form's action attribute is in the DOM snapshot; what must be absent is a request to it.
      expect(all).not.toMatch(/"path":"\/api\/examples\/signup"/);
    },
    assertProcessed({ session, incidents, findings }) {
      // The whole point of this example: the evidence summary has to say there is nothing to point at.
      expect(session.errorCount).toBe(0);
      expect(session.networkFailureCount).toBe(0);
      expect(incidents).toEqual([]);
      const evidence = findings[0]!.evidence!;
      expect(evidence.earliestError).toBeNull();
      expect(evidence.failedRequests).toEqual([]);
      expect(evidence.gaps).toContain('No uncaught error was recorded; the failure may be visual only.');
      expect(evidence.consoleErrors.map((c) => c.message)).toContain('code incomplete');
      expect(evidence.lastActions.at(-1)?.description).toMatch(/Clicked button "Finish"/);
    },
    brokenFailure: /finish|not enabled|Timeout|welcome/i,
  },
];

const decode = (buffer: Buffer): string => {
  try {
    return gunzipSync(buffer).toString('utf8');
  } catch {
    return buffer.toString('utf8');
  }
};

test('the gallery metadata agrees with this spec', async () => {
  const res = await fetch(`${env.demoUrl}/__demo/examples`);
  expect(res.status).toBe(200);
  const meta = (await res.json()) as { slug: string; path: string; successTestId: string }[];
  expect(meta.map((m) => [m.slug, m.path, m.successTestId])).toEqual(EXAMPLES.map((e) => [e.slug, e.path, e.successTestId]));
});

for (const example of EXAMPLES) {
  test.describe.serial(`example: ${example.slug}`, () => {
    const outbound: Buffer[] = [];
    let projectId = '';
    let sessionId = '';
    let generatedTestId = '';

    test.afterAll(async () => {
      await setDemoMode('broken');
    });

    test('the SDK records the broken workflow and no secret leaves the browser', async ({ page }) => {
      await setDemoMode('broken');
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.route('**/v1/ingest**', async (route) => {
        const body = route.request().postDataBuffer();
        if (body) outbound.push(body);
        await route.continue();
      });

      await example.walk(page);
      await example.assertBroken(page, pageErrors);
      await expect(page.getByTestId('demo-mode')).toHaveText('broken');

      sessionId = (await page.evaluate(() => window.Repro.getSessionId())) ?? '';
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
      await page.evaluate(async () => {
        await window.Repro.flush();
        window.Repro.stop();
        await window.Repro.flush();
      });
      await page.waitForTimeout(1500);
      expect(outbound.length, 'the SDK uploaded at least one batch').toBeGreaterThan(0);

      const all = outbound.map(decode).join('\n');
      expect(all).toContain(sessionId);
      expect(findCanaries(all)).toEqual([]);
      example.assertPayload?.(all);
    });

    test('the session is processed and a test is generated against the success test id', async () => {
      projectId = (await projectBySlug('demo')).id;
      const detail = await waitFor(
        async () => {
          const d = await api<SessionDetail>(`/api/projects/${projectId}/sessions/${sessionId}`);
          return d.session.status === 'completed' && d.findings.some((f) => f.kind === 'evidence') ? d : null;
        },
        { timeoutMs: 60_000, label: `session ${example.slug} completed and processed` },
      );
      expect(detail.session.initialRoute).toBe(example.path);
      example.assertProcessed?.(detail);

      const generated = await api<GeneratedTest>(`/api/projects/${projectId}/sessions/${sessionId}/tests`, {
        method: 'POST',
        body: JSON.stringify({
          testName: `examples ${example.slug}`,
          expectations: [{ kind: 'visible', testId: example.successTestId }],
        }),
      });
      generatedTestId = generated.id;
      expect(generated.code).toContain(`page.goto('${example.path}')`);
      expect(generated.code).toContain(`getByTestId('${example.successTestId}')`);
      expect(generated.code).toContain('pageErrors');
      expect(findCanaries(generated.code)).toEqual([]);
      expect(generated.code).not.toContain(SETTINGS_PASSWORD);
      expect(generated.code).not.toContain('482913');
      expect(generated.warnings.filter((w) => /Omitted|ignored/.test(w))).toEqual([]);
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
        { timeoutMs: 150_000, intervalMs: 1000, label: `reproduction run (${example.slug}, ${mode})` },
      );
    };

    test('the generated test fails on broken mode and passes on fixed mode', async () => {
      const broken = await runAndWait('broken');
      expect(broken.status, broken.failureMessage ?? broken.logs ?? '').toBe('failed');
      expect(broken.failureMessage ?? '').toMatch(example.brokenFailure);
      expect(broken.artifacts.map((a) => a.name)).toContain('trace.zip');

      const fixed = await runAndWait('fixed');
      expect(fixed.status, fixed.failureMessage ?? fixed.logs ?? '').toBe('passed');

      await setDemoMode('broken');
      const res = await fetch(`${env.demoUrl}/__demo/mode`);
      expect(await res.json()).toEqual({ mode: 'broken' });
    });
  });
}
