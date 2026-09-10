/** URL builders shared by server and client components. Segments are encoded once, here. */
export function projectPath(slug: string, ...segments: string[]): string {
  return ['/projects', encodeURIComponent(slug), ...segments.map(encodeURIComponent)].join('/');
}

export function apiPath(slug: string, ...segments: string[]): string {
  return ['/api/projects', encodeURIComponent(slug), ...segments.map(encodeURIComponent)].join('/');
}
