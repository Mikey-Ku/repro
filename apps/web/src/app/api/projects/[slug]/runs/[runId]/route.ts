import { getRun } from '@/lib/api';
import { withProject } from '@/lib/route';

type Params = { params: Promise<{ slug: string; runId: string }> };

/** Polled by the Runs tab while a reproduction run is queued or running. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, runId } = await params;
  return withProject(slug, async (project) => {
    const run = await getRun(project.id, runId);
    return Response.json(run, { headers: { 'cache-control': 'no-store' } });
  });
}
