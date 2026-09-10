/** Join class names, dropping falsy entries. Small enough that a dependency is not worth it. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
