import type { SessionSummary } from '@repro/contracts';
import { Badge, Table, Td, Th, statusTone } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBrowser, formatDateTime, formatDuration, formatNumber, formatRelative } from '@/lib/format';
import { projectPath } from '@/lib/paths';

/**
 * Session list. The first cell holds the only link; its ::after pseudo-element
 * is stretched over the positioned row, so a click anywhere opens the session
 * while keyboard and screen reader users still get exactly one anchor per row.
 */
export function SessionTable({ slug, sessions, compact }: { slug: string; sessions: SessionSummary[]; compact?: boolean }) {
  return (
    <Table caption="Sessions">
      <thead>
        <tr>
          <Th>Started</Th>
          <Th numeric>Duration</Th>
          <Th>Route</Th>
          <Th>Browser</Th>
          {compact ? null : <Th>Release</Th>}
          <Th numeric>Errors</Th>
          {compact ? null : <Th numeric>Network failures</Th>}
          {compact ? null : <Th numeric>Events</Th>}
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id} className="relative focus-within:bg-raised">
            <Td className="whitespace-nowrap">
              <a
                href={projectPath(slug, 'sessions', session.id)}
                title={formatDateTime(session.startedAt)}
                className="text-text after:absolute after:inset-0 after:content-[''] hover:no-underline"
              >
                {formatRelative(session.startedAt)}
              </a>
              <span className="block text-2xs text-muted">{formatDateTime(session.startedAt)}</span>
            </Td>
            <Td numeric mono>
              {formatDuration(session.durationMs)}
            </Td>
            <Td mono className="max-w-56 truncate" title={session.initialRoute}>
              {session.initialRoute}
            </Td>
            <Td>{formatBrowser(session.browserName, session.browserVersion)}</Td>
            {compact ? null : <Td mono>{session.release ?? 'n/a'}</Td>}
            <Td numeric className={cn(session.errorCount > 0 && 'text-danger')}>
              {formatNumber(session.errorCount)}
            </Td>
            {compact ? null : (
              <Td numeric className={cn(session.networkFailureCount > 0 && 'text-warning')}>
                {formatNumber(session.networkFailureCount)}
              </Td>
            )}
            {compact ? null : <Td numeric>{formatNumber(session.eventCount)}</Td>}
            <Td>
              <Badge tone={statusTone(session.status)}>{session.status}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
