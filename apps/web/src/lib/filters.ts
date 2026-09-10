import { z } from 'zod';
import { LIMITS, SessionStatus, type SessionFilters } from '@repro/contracts';

/**
 * Translate the session list's URL search params into the API's filter shape.
 * Pure function so the mapping is unit-testable without Next.js.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Accepts either a full ISO string or the value of an <input type="datetime-local">, read as UTC. */
function toIsoUtc(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
  const date = new Date(local ? `${value}Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const SearchSchema = z.object({
  status: z.preprocess((value) => (value === '' ? undefined : value), SessionStatus.optional()),
  release: optionalText(100),
  route: optionalText(500),
  browser: optionalText(50),
  hasErrors: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: optionalText(200),
  limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).optional(),
});

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ParsedSessionFilters {
  filters: Partial<SessionFilters>;
  /** Raw values echoed back into the form controls. */
  form: {
    status: string;
    release: string;
    route: string;
    browser: string;
    hasErrors: boolean;
    from: string;
    to: string;
  };
}

export function parseSessionFilters(searchParams: SearchParams): ParsedSessionFilters {
  const raw = Object.fromEntries(Object.entries(searchParams).map(([key, value]) => [key, first(value)]));
  const parsed = SearchSchema.safeParse(raw);
  // Bad input is ignored rather than surfaced: a hand-edited URL should still show the list.
  const data: Partial<z.infer<typeof SearchSchema>> = parsed.success ? parsed.data : {};
  const hasErrors = data.hasErrors === 'true' || data.hasErrors === 'on';
  return {
    filters: {
      status: data.status,
      release: data.release,
      route: data.route,
      browser: data.browser,
      hasErrors: hasErrors || undefined,
      from: toIsoUtc(data.from),
      to: toIsoUtc(data.to),
      cursor: data.cursor,
      limit: data.limit,
    },
    form: {
      status: data.status ?? '',
      release: data.release ?? '',
      route: data.route ?? '',
      browser: data.browser ?? '',
      hasErrors,
      from: data.from ?? '',
      to: data.to ?? '',
    },
  };
}

/** Build the query string for a "load more" link: the same filters plus the next cursor. */
export function withCursor(form: ParsedSessionFilters['form'], cursor: string): string {
  const params = new URLSearchParams();
  if (form.status) params.set('status', form.status);
  if (form.release) params.set('release', form.release);
  if (form.route) params.set('route', form.route);
  if (form.browser) params.set('browser', form.browser);
  if (form.hasErrors) params.set('hasErrors', 'true');
  if (form.from) params.set('from', form.from);
  if (form.to) params.set('to', form.to);
  params.set('cursor', cursor);
  return `?${params.toString()}`;
}
