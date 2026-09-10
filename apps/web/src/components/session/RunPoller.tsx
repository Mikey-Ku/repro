'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { apiPath } from '@/lib/paths';

const SETTLED = new Set(['passed', 'failed', 'error', 'timeout']);

/**
 * Polls the run proxy every two seconds while a run is queued or running and
 * refreshes the server-rendered page once it settles. Renders a live region so
 * assistive tech hears that a run is in progress.
 */
export function RunPoller({ slug, runIds }: { slug: string; runIds: string[] }) {
  const router = useRouter();

  useEffect(() => {
    if (!runIds.length) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const results = await Promise.all(
          runIds.map(async (runId) => {
            const response = await fetch(apiPath(slug, 'runs', runId), { cache: 'no-store' });
            if (!response.ok) return null;
            const run = (await response.json()) as { status?: string };
            return run.status ?? null;
          }),
        );
        if (stopped) return;
        if (results.some((status) => status !== null && SETTLED.has(status))) router.refresh();
      } catch {
        // Network hiccup: try again on the next tick.
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [slug, runIds, router]);

  return (
    <p role="status" aria-live="polite" className="text-2xs text-muted">
      {runIds.length === 1 ? 'A run is in progress. This panel updates automatically.' : `${runIds.length} runs are in progress. This panel updates automatically.`}
    </p>
  );
}
