import { getExpectationSuggestions } from '@/lib/api';
import { withProject } from '@/lib/route';

type Params = { params: Promise<{ slug: string; id: string }> };

/**
 * Proxy for the "Suggest from a passing session" block in the Test tab. The browser passes the
 * reference session id; the server forwards the call with the internal token, which never leaves Node.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { slug, id } = await params;
  const reference = new URL(request.url).searchParams.get('reference')?.trim() || undefined;
  return withProject(slug, async (project) => {
    const data = await getExpectationSuggestions(project.id, id, reference);
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  });
}
