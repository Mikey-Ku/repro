import type { ReactNode } from 'react';
import { Disconnected } from '@/components/layout/Disconnected';
import { Shell } from '@/components/layout/Shell';
import { ping } from '@/lib/api';
import { ingestUrl } from '@/lib/env';
import { requireProject } from '@/lib/project';

/**
 * Every project page shares this chrome. The ping runs per request: when the
 * ingest service is down we render the disconnected card instead of the page,
 * so a stopped backend never turns into a stack trace.
 */
export default async function ProjectLayout({ params, children }: { params: Promise<{ slug: string }>; children: ReactNode }) {
  const { slug } = await params;
  const health = await ping();
  if (!health) {
    return (
      <Shell slug={slug} projectName={slug} health={null}>
        <Disconnected ingestUrl={ingestUrl()} />
      </Shell>
    );
  }
  const project = await requireProject(slug);
  return (
    <Shell slug={slug} projectName={project.name} health={health}>
      {children}
    </Shell>
  );
}
