'use client';

import { useActionState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui';
import { createKeyAction, type ActionResult, type CreatedKey } from '@/lib/actions';

/**
 * Creates a key and shows the plaintext exactly once. The value lives only in
 * this component's action state; a reload clears it and it cannot be recovered.
 */
export function CreateKeyForm({ slug }: { slug: string }) {
  const [result, formAction, pending] = useActionState<ActionResult<CreatedKey> | null, FormData>(createKeyAction.bind(null, slug), null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="key-label" className="text-2xs font-medium tracking-wide text-muted uppercase">
            New key label
          </label>
          <input id="key-label" name="label" required maxLength={100} placeholder="production web" className="h-8 rounded-md border border-border bg-raised px-2 text-sm text-text" />
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Creating' : 'Create key'}
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {result && !result.ok ? <p className="text-xs text-danger">{result.message}</p> : null}
        {result?.ok && result.data ? (
          <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs">
            <p className="font-medium text-text">Key "{result.data.label}" created. Copy it now; it will not be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-raised px-2 py-1 font-mono">{result.data.key}</code>
              <CopyButton text={result.data.key} label="Copy key" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
