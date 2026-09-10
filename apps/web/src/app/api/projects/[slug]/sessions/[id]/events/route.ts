import { getSessionEvents } from '@/lib/api';
import { withProject } from '@/lib/route';

type Params = { params: Promise<{ slug: string; id: string }> };

/**
 * Proxy for the replay player. The browser asks this route for events and the
 * server forwards the call with the internal token, which never leaves Node.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { slug, id } = await params;
  const types = new URL(request.url).searchParams.get('types');
  const typeList = types
    ? types
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;
  return withProject(slug, async (project) => {
    const data = await getSessionEvents(project.id, id, typeList);
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  });
}
