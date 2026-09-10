import type { SessionListResponse } from '@repro/contracts';
import { LinkButton, buttonClasses } from '@/components/ui';
import type { ParsedSessionFilters } from '@/lib/filters';
import { projectPath } from '@/lib/paths';

const control = 'h-8 min-w-0 rounded-md border border-border bg-raised px-2 text-sm text-text';

/**
 * Plain GET form: submitting it updates the URL, the server re-renders the
 * list, and the URL stays shareable. No JavaScript is involved.
 */
export function SessionFilterForm({ slug, form, facets }: { slug: string; form: ParsedSessionFilters['form']; facets: SessionListResponse['facets'] }) {
  const hasFilters = Boolean(form.status || form.release || form.route || form.browser || form.hasErrors || form.from || form.to);
  return (
    <form method="get" action={projectPath(slug, 'sessions')} className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-7" aria-label="Filter sessions">
      <Field label="Status" htmlFor="filter-status">
        <select id="filter-status" name="status" defaultValue={form.status} className={control}>
          <option value="">Any</option>
          <option value="recording">recording</option>
          <option value="completed">completed</option>
          <option value="expired">expired</option>
        </select>
      </Field>
      <Field label="Release" htmlFor="filter-release">
        <select id="filter-release" name="release" defaultValue={form.release} className={control}>
          <option value="">Any</option>
          {facets.releases.map((release) => (
            <option key={release} value={release}>
              {release}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Route" htmlFor="filter-route">
        <input id="filter-route" name="route" list="filter-route-options" defaultValue={form.route} placeholder="/checkout" className={control} />
        <datalist id="filter-route-options">
          {facets.routes.map((route) => (
            <option key={route} value={route} />
          ))}
        </datalist>
      </Field>
      <Field label="Browser" htmlFor="filter-browser">
        <select id="filter-browser" name="browser" defaultValue={form.browser} className={control}>
          <option value="">Any</option>
          {facets.browsers.map((browser) => (
            <option key={browser} value={browser}>
              {browser}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From (UTC)" htmlFor="filter-from">
        <input id="filter-from" name="from" type="datetime-local" defaultValue={form.from} className={control} />
      </Field>
      <Field label="To (UTC)" htmlFor="filter-to">
        <input id="filter-to" name="to" type="datetime-local" defaultValue={form.to} className={control} />
      </Field>
      <div className="col-span-2 flex flex-wrap items-end gap-3 sm:col-span-3 lg:col-span-1">
        <label className="flex min-h-8 items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="hasErrors" value="true" defaultChecked={form.hasErrors} className="h-4 w-4 accent-accent" />
          With errors
        </label>
        <button type="submit" className={buttonClasses('primary', 'md')}>
          Apply
        </button>
        {hasFilters ? (
          <LinkButton href={projectPath(slug, 'sessions')} variant="ghost">
            Clear
          </LinkButton>
        ) : null}
      </div>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-2xs font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
