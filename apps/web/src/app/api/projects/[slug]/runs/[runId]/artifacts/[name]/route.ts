import { fetchArtifact } from '@/lib/api';
import { jsonError, passthrough, withProject } from '@/lib/route';

type Params = { params: Promise<{ slug: string; runId: string; name: string }> };

/** Only the three artifacts the runner produces can be requested. Anything else is a 404 before any upstream call. */
const ALLOWED = new Set(['screenshot.png', 'trace.zip', 'report.json']);

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, runId, name } = await params;
  if (!ALLOWED.has(name)) return jsonError(404, 'not_found', 'Unknown artifact');
  return withProject(slug, async (project) => {
    const upstream = await fetchArtifact(project.id, runId, name);
    // trace.zip is opened in Playwright's trace viewer, so serve it as a download.
    const extra: Record<string, string> = name === 'trace.zip' ? { 'content-disposition': `attachment; filename="trace-${runId.slice(0, 8)}.zip"` } : {};
    return passthrough(upstream, extra);
  });
}
