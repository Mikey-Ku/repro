import type { ReactNode } from 'react';
import type { Health } from '@repro/contracts';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/cn';

/**
 * Page chrome for every project route: sidebar, connectivity indicator and the
 * main landmark the skip link targets. Server component; the sidebar is the
 * only client piece (it needs the pathname and the menu toggle).
 */
export function Shell({ slug, projectName, health, children }: { slug: string; projectName: string; health: Health | null; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar slug={slug} projectName={projectName} status={<ConnectivityIndicator health={health} />} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-5">
        {children}
      </main>
    </div>
  );
}

/** Rendered per request from ping(): a dot plus the ingest version, or a warning when unreachable. */
export function ConnectivityIndicator({ health }: { health: Health | null }) {
  const ok = health?.ok === true;
  return (
    <p className="flex items-center gap-2 px-1 text-2xs text-muted" role="status">
      <span aria-hidden="true" className={cn('inline-block h-2 w-2 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
      {ok ? (
        <span>
          Ingest connected <span className="font-mono">v{health.version}</span>
        </span>
      ) : (
        <span>Ingest disconnected</span>
      )}
    </p>
  );
}
