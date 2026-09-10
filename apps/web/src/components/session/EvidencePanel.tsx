import type { EvidenceSummary } from '@repro/contracts';
import { RefButton } from './SeekButton';
import { Badge, Table, Td, Th } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration, formatNumber } from '@/lib/format';

/**
 * Deterministic evidence summary. Every item carries a ref into the replay;
 * nothing here is inferred. Text from the recording is rendered as text.
 */
export function EvidencePanel({ evidence }: { evidence: EvidenceSummary }) {
  const { earliestError, requestsBeforeError, failedRequests, slowRequests, lastActions, consoleErrors, gaps, stats } = evidence;
  return (
    <div className="divide-y divide-border text-xs">
      <Section title="Earliest error">
        {earliestError ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <RefButton evidenceRef={earliestError.ref} />
              <Badge tone="danger">{earliestError.kind}</Badge>
              <span className="text-text">
                {earliestError.name ? `${earliestError.name}: ` : ''}
                {earliestError.message}
              </span>
            </p>
            {earliestError.stack ? (
              <details>
                <summary className="cursor-pointer text-2xs text-muted select-none">Stack trace</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-background px-2 py-1 text-2xs text-muted">{earliestError.stack}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-muted">No error was captured.</p>
        )}
      </Section>

      <Section title="Requests before the error" count={requestsBeforeError.length}>
        {requestsBeforeError.length ? (
          <Table caption="Requests before the error">
            <thead>
              <tr>
                <Th>At</Th>
                <Th>Method</Th>
                <Th>Path</Th>
                <Th numeric>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requestsBeforeError.map((request) => (
                <tr key={request.ref.seq}>
                  <Td>
                    <RefButton evidenceRef={request.ref} />
                  </Td>
                  <Td mono>{request.method}</Td>
                  <Td mono className="max-w-64 truncate" title={request.path}>
                    {request.path}
                  </Td>
                  <Td numeric mono className={cn(!request.ok && 'text-danger')}>
                    {request.status ?? 'failed'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-muted">None recorded.</p>
        )}
      </Section>

      <Section title="Failed requests" count={failedRequests.length}>
        {failedRequests.length ? (
          <ul className="space-y-1">
            {failedRequests.map((request) => (
              <li key={request.ref.seq} className="flex flex-wrap items-center gap-2">
                <RefButton evidenceRef={request.ref} />
                <span className="font-mono">
                  {request.method} {request.path}
                </span>
                <Badge tone="danger">{request.status ?? 'failed'}</Badge>
                <span className="text-muted">{formatDuration(request.durationMs)}</span>
                {request.error ? <span className="text-muted">{request.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None.</p>
        )}
      </Section>

      <Section title="Slow requests" count={slowRequests.length}>
        {slowRequests.length ? (
          <ul className="space-y-1">
            {slowRequests.map((request) => (
              <li key={request.ref.seq} className="flex flex-wrap items-center gap-2">
                <RefButton evidenceRef={request.ref} />
                <span className="font-mono">
                  {request.method} {request.path}
                </span>
                <Badge tone="warning">{formatDuration(request.durationMs)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None over the threshold.</p>
        )}
      </Section>

      <Section title="Last actions" count={lastActions.length}>
        {lastActions.length ? (
          <ol className="space-y-1">
            {lastActions.map((action) => (
              <li key={action.ref.seq} className="flex items-center gap-2">
                <RefButton evidenceRef={action.ref} />
                <span>{action.description}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">No user actions were recorded.</p>
        )}
      </Section>

      <Section title="Console errors" count={consoleErrors.length}>
        {consoleErrors.length ? (
          <ul className="space-y-1">
            {consoleErrors.map((entry) => (
              <li key={entry.ref.seq} className="flex items-start gap-2">
                <RefButton evidenceRef={entry.ref} />
                <span className="min-w-0">
                  <Badge tone={entry.level === 'error' ? 'danger' : 'warning'}>{entry.level}</Badge> <span className="font-mono break-all">{entry.message}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None.</p>
        )}
      </Section>

      <Section title="What the evidence does not show" count={gaps.length}>
        {gaps.length ? (
          <ul className="list-disc space-y-1 pl-4 text-muted">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No gaps were reported.</p>
        )}
      </Section>

      <Section title="Stats">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Events" value={formatNumber(stats.events)} />
          <Stat label="Errors" value={formatNumber(stats.errors)} />
          <Stat label="Requests" value={formatNumber(stats.requests)} />
          <Stat label="Actions" value={formatNumber(stats.actions)} />
          <Stat label="Duration" value={formatDuration(stats.durationMs)} />
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="px-3 py-2.5">
      <h3 className="mb-1.5 text-2xs font-semibold tracking-wide text-muted uppercase">
        {title}
        {count !== undefined ? <span className="ml-1 font-mono font-normal">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className="font-mono text-sm text-text">{value}</dd>
    </div>
  );
}
