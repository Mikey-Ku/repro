import Link from 'next/link';
import type { SessionSummary } from '@repro/contracts';
import { JumpToErrorButton } from './JumpToErrorButton';
import { Badge, statusTone } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBrowser, formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { projectPath } from '@/lib/paths';

export function SessionHeader({ slug, session, firstErrorOffsetMs }: { slug: string; session: SessionSummary; firstErrorOffsetMs: number | null }) {
  return (
    <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-2xs text-muted">
          <Link href={projectPath(slug, 'sessions')}>Sessions</Link> / <span className="font-mono">{session.id}</span>
        </p>
        <h1 className="truncate font-mono text-base font-semibold text-text" title={session.initialRoute}>
          {session.initialRoute}
        </h1>
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <Meta label="Started">{formatDateTime(session.startedAt)}</Meta>
          <Meta label="Duration">{formatDuration(session.durationMs)}</Meta>
          <Meta label="Browser">{formatBrowser(session.browserName, session.browserVersion)}</Meta>
          <Meta label="Release">{session.release ?? 'n/a'}</Meta>
          <Meta label="Status">
            <Badge tone={statusTone(session.status)}>{session.status}</Badge>
          </Meta>
          <Meta label="Errors">
            <span className={cn('font-mono', session.errorCount > 0 && 'text-danger')}>{formatNumber(session.errorCount)}</span>
          </Meta>
        </dl>
      </div>
      <JumpToErrorButton offsetMs={firstErrorOffsetMs} />
    </header>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <dt className="text-2xs tracking-wide uppercase">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}
