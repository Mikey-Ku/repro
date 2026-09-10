import 'server-only';

import { notFound } from 'next/navigation';
import { getProjectBySlug, isNotFound } from './api';
import type { ProjectWithStats } from './schemas';

/**
 * Resolve the project for a route segment. An unknown slug becomes a 404 page;
 * every other failure (including an unreachable ingest service) propagates to
 * the nearest error boundary, which renders the disconnected state.
 */
export async function requireProject(slug: string): Promise<ProjectWithStats> {
  try {
    return await getProjectBySlug(slug);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
}
