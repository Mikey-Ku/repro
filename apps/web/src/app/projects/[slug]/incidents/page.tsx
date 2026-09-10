import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { IncidentTable } from '@/components/incidents/IncidentTable';
import { Card, EmptyState, LinkButton } from '@/components/ui';
import { listIncidents } from '@/lib/api';
import { projectPath } from '@/lib/paths';
import { requireProject } from '@/lib/project';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string | string[] }> };

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const project = await requireProject(slug);
  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = raw === 'resolved' ? 'resolved' : raw === 'all' ? undefined : 'open';
  const incidents = await listIncidents(project.id, { status, limit: 100 });

  const tab = (value: string, label: string, active: boolean) => (
    <LinkButton key={value} href={`${projectPath(slug, 'incidents')}?status=${value}`} variant={active ? 'primary' : 'secondary'} size="sm">
      {label}
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        title="Incidents"
        description="One incident per distinct error fingerprint in a session. Resolve them here; the session stays."
        actions={
          <div role="group" aria-label="Incident status" className="flex gap-1">
            {tab('open', 'Open', status === 'open')}
            {tab('resolved', 'Resolved', status === 'resolved')}
            {tab('all', 'All', status === undefined)}
          </div>
        }
      />
      <Card>
        {incidents.length ? (
          <IncidentTable slug={slug} incidents={incidents} />
        ) : (
          <EmptyState title={status === 'open' ? 'No open incidents' : 'No incidents'} description="Incidents are extracted by the worker after a session completes." />
        )}
      </Card>
    </>
  );
}
