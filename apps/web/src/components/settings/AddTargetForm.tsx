'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { addTargetAction, type ActionResult } from '@/lib/actions';

/** Name plus origin. The server normalises the url to its origin and refuses anything with a path, query or credentials. */
export function AddTargetForm({ slug }: { slug: string }) {
  const [result, formAction, pending] = useActionState<ActionResult | null, FormData>(addTargetAction.bind(null, slug), null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="target-name" className="text-2xs font-medium tracking-wide text-muted uppercase">
            Target name
          </label>
          <input id="target-name" name="name" required maxLength={100} placeholder="staging" className="h-8 w-40 rounded-md border border-border bg-raised px-2 text-sm text-text" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="target-url" className="text-2xs font-medium tracking-wide text-muted uppercase">
            Origin
          </label>
          <input
            id="target-url"
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://staging.example.com"
            className="h-8 rounded-md border border-border bg-raised px-2 font-mono text-sm text-text"
          />
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding' : 'Add target'}
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {result && !result.ok ? <p className="text-xs text-danger">{result.message}</p> : null}
        {result?.ok ? <p className="text-xs text-success">{result.message}</p> : null}
      </div>
      <p className="text-2xs text-muted">Origins only (scheme, host, port). Up to 10 per project. Runs against a target execute on the worker's machine and switch nothing on the target.</p>
    </div>
  );
}
