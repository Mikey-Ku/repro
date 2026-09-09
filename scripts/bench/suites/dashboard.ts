import { chromium } from '@playwright/test';
import { env, percentile, round } from '../env.js';
import type { DashboardResult } from '../report.js';

const internal = { 'x-repro-internal-token': env.internalToken };

export async function benchDashboard(sessionId: string | null, loads = 10): Promise<DashboardResult> {
  const projectId = ((await (await fetch(`${env.ingestUrl}/api/projects/by-slug/demo`, { headers: internal })).json()) as { id: string }).id;
  if (!sessionId) {
    const list = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions?hasErrors=true&limit=1`, { headers: internal })).json()) as { items: { id: string }[] };
    sessionId = list.items[0]?.id ?? null;
  }
  if (!sessionId) throw new Error('No session available for the dashboard benchmark. Run the workflow suite or the E2E test first.');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sessionPage: number[] = [];
  const replayReady: number[] = [];
  const listPage: number[] = [];
  const timelineApi: number[] = [];

  // Warm the Next.js route once.
  await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`);
  await page.goto(`${env.webUrl}/projects/demo/sessions`);

  for (let i = 0; i < loads; i += 1) {
    const t0 = performance.now();
    await page.goto(`${env.webUrl}/projects/demo/sessions/${sessionId}`, { waitUntil: 'load' });
    const nav = await page.evaluate(() => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming);
    sessionPage.push(nav.domComplete);
    await page.frameLocator('.rr-player iframe').first().locator('body *').first().waitFor({ state: 'attached', timeout: 30_000 });
    replayReady.push(performance.now() - t0);

    await page.goto(`${env.webUrl}/projects/demo/sessions`, { waitUntil: 'load' });
    const navList = await page.evaluate(() => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming);
    listPage.push(navList.domComplete);

    const a = performance.now();
    await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}/timeline`, { headers: internal }).then((r) => r.json());
    timelineApi.push(performance.now() - a);
  }
  await browser.close();

  return {
    loads,
    sessionPageP50Ms: round(percentile(sessionPage, 50)),
    sessionPageP95Ms: round(percentile(sessionPage, 95)),
    replayReadyP50Ms: round(percentile(replayReady, 50)),
    replayReadyP95Ms: round(percentile(replayReady, 95)),
    listPageP50Ms: round(percentile(listPage, 50)),
    listPageP95Ms: round(percentile(listPage, 95)),
    timelineApiP50Ms: round(percentile(timelineApi, 50)),
    timelineApiP95Ms: round(percentile(timelineApi, 95)),
  };
}
