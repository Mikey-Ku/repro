import Link from 'next/link';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { IconJump } from '@/components/icons';
import { Badge, Button, Card, CardBody, CardHeader, LinkButton, statusTone } from '@/components/ui';
import { patchIncidentAction } from '@/lib/actions';
import { getIncident, isNotFound } from '@/lib/api';
import { formatBrowser, formatDateTime, formatDuration, formatOffset, shortId } from '@/lib/format';
import { projectPath } from '@/lib/paths';
import { requireProject } from '@/lib/project';
import { notFound } from 'next/navigation';

type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Incident ${shortId(id)}` };
}

export default async function IncidentPage({ params }: Props) {
  const { slug, id } = await params;
  const project = await requireProject(slug);
  let detail;
  try {
    detail = await getIncident(project.id, id);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  const { incident, session, tests } = detail;
  const replayHref = `${projectPath(slug, 'sessions', session.id)}?t=${incident.offsetMs}&tab=timeline`;
  const nextStatus = incident.status === 'open' ? 'resolved' : 'open';
  const patch = patchIncidentAction.bind(null, slug, incident.id);

  return (
    <>
      <PageHeader
        title={incident.title}
        description={
          <>
            <Badge tone={statusTone(incident.status)}>{incident.status}</Badge> <Badge>{incident.kind}</Badge> first seen {formatDateTime(incident.firstTs)}
          </>
        }
        actions={
          <>
            <LinkButton href={replayHref} variant="primary">
              <IconJump size={14} />
              Open replay at error
            </LinkButton>
            <form action={patch}>
              <input type="hidden" name="status" value={nextStatus} />
              <Button type="submit">{incident.status === 'open' ? 'Mark resolved' : 'Reopen'}</Button>
            </form>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Message" />
          <CardBody>
            <pre className="text-xs">{incident.message}</pre>
          </CardBody>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs md:grid-cols-4">
            <Item label="Offset" value={formatOffset(incident.offsetMs)} mono />
            <Item label="Route" value={incident.route ?? 'n/a'} mono />
            <Item label="Release" value={incident.release ?? 'n/a'} mono />
            <Item label="Fingerprint" value={shortId(incident.fingerprint)} mono />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Session" actions={<Link href={projectPath(slug, 'sessions', session.id)}>Open</Link>} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-xs">
            <Item label="Started" value={formatDateTime(session.startedAt)} />
            <Item label="Duration" value={formatDuration(session.durationMs)} mono />
            <Item label="Browser" value={formatBrowser(session.browserName, session.browserVersion)} />
            <Item label="Errors" value={String(session.errorCount)} mono />
          </dl>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Generated tests" description="Tests generated from this incident's session." />
          <CardBody>
            {tests.length ? (
              <ul className="divide-y divide-border text-sm">
                {tests.map((test) => (
                  <li key={test.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-mono text-xs text-muted">v{test.version}</span> {test.name}
                    </span>
                    <Link href={`${projectPath(slug, 'sessions', session.id)}?tab=test&v=${test.version}`}>View test</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">
                None yet. <Link href={`${projectPath(slug, 'sessions', session.id)}?tab=test`}>Generate one from the session</Link>.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className={mono ? 'truncate font-mono' : 'truncate'} title={value}>
        {value}
      </dd>
    </div>
  );
}
