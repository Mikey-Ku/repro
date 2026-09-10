import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui';

/**
 * Shown instead of a page when the ingest service cannot be reached. It is a
 * plain component so both server layouts (which know the URL) and client error
 * boundaries (which do not) can render it.
 */
export function Disconnected({ ingestUrl, action }: { ingestUrl?: string; action?: ReactNode }) {
  return (
    <Card className="mx-auto mt-8 max-w-xl">
      <CardHeader title="Ingest service unreachable" description="The dashboard reads everything from the ingest API and cannot render without it." />
      <CardBody className="space-y-3 text-sm">
        {ingestUrl ? (
          <p>
            Configured <code className="rounded bg-raised px-1">INGEST_URL</code>: <code className="rounded bg-raised px-1">{ingestUrl}</code>
          </p>
        ) : null}
        <p className="text-muted">To start it locally:</p>
        <pre className="rounded-md border border-border bg-raised px-3 py-2 text-xs">
          {['pnpm db:up', 'pnpm db:migrate && pnpm db:seed', 'pnpm --filter @repro/ingest dev'].join('\n')}
        </pre>
        <p className="text-muted">
          Set <code className="rounded bg-raised px-1">INGEST_URL</code> and <code className="rounded bg-raised px-1">REPRO_INTERNAL_TOKEN</code> in the repository <code className="rounded bg-raised px-1">.env</code> if the service runs elsewhere. Reload once it is up.
        </p>
        {action}
      </CardBody>
    </Card>
  );
}
