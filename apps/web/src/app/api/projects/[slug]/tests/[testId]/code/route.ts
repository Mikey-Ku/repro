import { fetchTestCode } from '@/lib/api';
import { passthrough, withProject } from '@/lib/route';

type Params = { params: Promise<{ slug: string; testId: string }> };

/** Streams the generated spec file with the upstream content-disposition so the browser saves it. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, testId } = await params;
  return withProject(slug, async (project) => passthrough(await fetchTestCode(project.id, testId)));
}
