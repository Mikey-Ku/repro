import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { IncidentGroupTable } from '@/components/incidents/IncidentGroupTable';
import { IncidentTable } from '@/components/incidents/IncidentTable';
import { Card, EmptyState, LinkButton, buttonClasses } from '@/components/ui';
import { listIncidentGroups, listIncidents } from '@/lib/api';
import { projectPath } from '@/lib/paths';
import { requireProject } from '@/lib/project';

type SearchParams = { status?: string | string[]; view?: string | string[] };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

type View = 'groups' | 'sessions';
type StatusFilter = 'open' | 'resolved' | 'all';

export const metadata: Metadata = { title: 'Incidents' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function IncidentsPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const project = await requireProject(slug);

  const rawStatus = first(query.status);
  const statusFilter: StatusFilter = rawStatus === 'resolved' ? 'resolved' : rawStatus === 'all' ? 'all' : 'open';
  const status = statusFilter === 'all' ? undefined : statusFilter;
  // Grouped is the default; the per-session list stays one click away.
  const view: View = first(query.view) === 'sessions' ? 'sessions' : 'groups';

  // Every link on the page keeps both parameters so switching one never resets the other.
  const href = (next: { status?: StatusFilter; view?: View }) => {
    const search = new URLSearchParams();
    search.set('status', next.status ?? statusFilter);
    if ((next.view ?? view) === 'sessions') search.set('view', 'sessions');
    return `${projectPath(slug, 'incidents')}?${search.toString()}`;
  };

  const tab = (value: StatusFilter, label: string) => (
    <LinkButton key={value} href={href({ status: value })} variant={statusFilter === value ? 'primary' : 'secondary'} size="sm">
      {label}
    </LinkButton>
  );

  const viewLink = (value: View, label: string) => {
    const active = view === value;
    return (
      <Link href={href({ view: value })} aria-current={active ? 'page' : undefined} className={buttonClasses(active ? 'secondary' : 'ghost', 'sm', 'hover:no-underline')}>
        {label}
      </Link>
    );
  };

  const emptyTitle = status === 'open' ? 'No open incidents' : 'No incidents';
  const emptyDescription = 'Incidents are extracted by the worker after a session completes.';

  return (
    <>
      <PageHeader
        title="Incidents"
        description={
          view === 'groups'
            ? 'One row per error fingerprint across every session. Open the row to land on the latest occurrence.'
            : 'One incident per distinct error fingerprint in a session. Resolve them here; the session stays.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <nav aria-label="Incident view" className="flex gap-1">
              {viewLink('groups', 'Grouped')}
              {viewLink('sessions', 'By session')}
            </nav>
            <div role="group" aria-label="Incident status" className="flex gap-1">
              {tab('open', 'Open')}
              {tab('resolved', 'Resolved')}
              {tab('all', 'All')}
            </div>
          </div>
        }
      />
      <Card>{view === 'groups' ? <GroupedView slug={slug} projectId={project.id} status={status} emptyTitle={emptyTitle} emptyDescription={emptyDescription} /> : <SessionView slug={slug} projectId={project.id} status={status} emptyTitle={emptyTitle} emptyDescription={emptyDescription} />}</Card>
    </>
  );
}

type ViewProps = { slug: string; projectId: string; status?: 'open' | 'resolved'; emptyTitle: string; emptyDescription: string };

async function GroupedView({ slug, projectId, status, emptyTitle, emptyDescription }: ViewProps) {
  const groups = await listIncidentGroups(projectId, { status, limit: 100 });
  return groups.length ? <IncidentGroupTable slug={slug} groups={groups} /> : <EmptyState title={emptyTitle} description={emptyDescription} />;
}

async function SessionView({ slug, projectId, status, emptyTitle, emptyDescription }: ViewProps) {
  const incidents = await listIncidents(projectId, { status, limit: 100 });
  return incidents.length ? <IncidentTable slug={slug} incidents={incidents} /> : <EmptyState title={emptyTitle} description={emptyDescription} />;
}
