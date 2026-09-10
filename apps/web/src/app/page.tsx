import { redirect } from 'next/navigation';
import { Disconnected } from '@/components/layout/Disconnected';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { isUnreachable, listProjects } from '@/lib/api';
import { ingestUrl } from '@/lib/env';
import { projectPath } from '@/lib/paths';

/** The root only picks a project: `demo` when seeded, otherwise the first one. */
export default async function HomePage() {
  let projects;
  try {
    projects = await listProjects();
  } catch (error) {
    if (isUnreachable(error)) {
      return (
        <main id="main" className="px-4">
          <Disconnected ingestUrl={ingestUrl()} />
        </main>
      );
    }
    throw error;
  }

  const target = projects.find((project) => project.slug === 'demo') ?? projects[0];
  if (target) redirect(projectPath(target.slug));

  return (
    <main id="main" className="px-4">
      <Card className="mx-auto mt-8 max-w-xl">
        <CardHeader title="No projects yet" description="The ingest service is up but the database has no projects." />
        <CardBody className="space-y-3 text-sm">
          <p className="text-muted">Seed the local demo project and ingestion key:</p>
          <pre className="rounded-md border border-border bg-raised px-3 py-2 text-xs">pnpm db:seed</pre>
          <p className="text-muted">Then reload this page. The seed creates a project with the slug `demo`.</p>
        </CardBody>
      </Card>
    </main>
  );
}
