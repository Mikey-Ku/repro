import Link from 'next/link';
import type { Metadata } from 'next';
import { CodeSnippet } from '@/components/CodeSnippet';
import { PageHeader } from '@/components/PageHeader';
import { IncidentTable } from '@/components/incidents/IncidentTable';
import { SessionTable } from '@/components/sessions/SessionTable';
import { Card, CardBody, CardHeader, EmptyState, StatTile } from '@/components/ui';
import { listIncidents, listSessions } from '@/lib/api';
import { ingestUrl } from '@/lib/env';
import { formatRelative } from '@/lib/format';
import { projectPath } from '@/lib/paths';
import { requireProject } from '@/lib/project';
import { sdkSnippet } from '@/lib/snippet';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} overview` };
}

export default async function OverviewPage({ params }: Props) {
  const { slug } = await params;
  const project = await requireProject(slug);
  const [recent, openIncidents] = await Promise.all([
    listSessions(project.id, { limit: 10 }),
    listIncidents(project.id, { status: 'open', limit: 10 }),
  ]);
  const { stats } = project;

  return (
    <>
      <PageHeader title={project.name} description={stats.lastSessionAt ? `Last session ${formatRelative(stats.lastSessionAt)}` : 'No sessions recorded yet'} />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Sessions" value={stats.sessions} href={projectPath(slug, 'sessions')} />
        <StatTile label="Sessions with errors" value={stats.sessionsWithErrors} tone="danger" href={`${projectPath(slug, 'sessions')}?hasErrors=true`} />
        <StatTile label="Open incidents" value={stats.openIncidents} tone="warning" href={projectPath(slug, 'incidents')} />
        <StatTile label="Generated tests" value={stats.generatedTests} />
        <StatTile label="Runs" value={stats.runs} />
      </dl>

      {stats.sessions === 0 ? <GetStarted /> : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent sessions" actions={<Link href={projectPath(slug, 'sessions')}>All sessions</Link>} />
          {recent.items.length ? (
            <SessionTable slug={slug} sessions={recent.items} compact />
          ) : (
            <EmptyState compact title="No sessions yet" description="Sessions appear here as soon as the SDK uploads its first batch." />
          )}
        </Card>
        <Card>
          <CardHeader title="Open incidents" actions={<Link href={projectPath(slug, 'incidents')}>All incidents</Link>} />
          {openIncidents.length ? (
            <IncidentTable slug={slug} incidents={openIncidents} compact />
          ) : (
            <EmptyState compact title="No open incidents" description="Incidents are extracted from uncaught errors, failed requests and console errors after a session completes." />
          )}
        </Card>
      </div>
    </>
  );
}

function GetStarted() {
  return (
    <Card className="mt-4">
      <CardHeader title="Get started" description="Add the SDK to the application you want to record. Recording starts on init and uploads in gzip batches." />
      <CardBody className="space-y-3">
        <CodeSnippet label="SDK snippet" code={sdkSnippet('<ingestion key from Settings>', ingestUrl())} />
        <p className="text-xs text-muted">
          Create an ingestion key under Settings. Locally, `pnpm db:seed` already created one and the demo app at port 4100 uses it.
        </p>
      </CardBody>
    </Card>
  );
}
