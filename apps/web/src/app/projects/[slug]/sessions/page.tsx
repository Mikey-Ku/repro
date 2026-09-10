import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SessionFilterForm } from '@/components/sessions/SessionFilterForm';
import { SessionTable } from '@/components/sessions/SessionTable';
import { Card, CardBody, EmptyState, LinkButton } from '@/components/ui';
import { listSessions } from '@/lib/api';
import { parseSessionFilters, withCursor, type SearchParams } from '@/lib/filters';
import { projectPath } from '@/lib/paths';
import { requireProject } from '@/lib/project';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

export const metadata: Metadata = { title: 'Sessions' };

export default async function SessionsPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const project = await requireProject(slug);
  const { filters, form } = parseSessionFilters(query);
  const page = await listSessions(project.id, filters);

  return (
    <>
      <PageHeader title="Sessions" description={`${project.stats.sessions} recorded, ${project.stats.sessionsWithErrors} with errors`} />
      <Card className="mb-4">
        <CardBody>
          <SessionFilterForm slug={slug} form={form} facets={page.facets} />
        </CardBody>
      </Card>
      <Card>
        {page.items.length ? (
          <>
            <SessionTable slug={slug} sessions={page.items} />
            {page.nextCursor ? (
              <div className="flex justify-center border-t border-border px-4 py-3">
                <LinkButton href={`${projectPath(slug, 'sessions')}${withCursor(form, page.nextCursor)}`}>Load more</LinkButton>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={filters.cursor ? 'No more sessions' : 'No sessions match'}
            description={project.stats.sessions === 0 ? 'Nothing has been recorded yet. Add the SDK to your application, or run the demo app on port 4100.' : 'Try clearing a filter.'}
          />
        )}
      </Card>
    </>
  );
}
