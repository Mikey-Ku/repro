'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui';
import { removeTargetAction } from '@/lib/actions';

/** Removal only affects future runs (past runs keep their copy of the target), but it is still confirmed. */
export function RemoveTargetButton({ slug, targetId, name }: { slug: string; targetId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const remove = () => {
    if (!window.confirm(`Remove the target "${name}"? Runs already recorded against it keep its name and url.`)) return;
    startTransition(async () => {
      await removeTargetAction(slug, targetId);
    });
  };
  return (
    <Button size="sm" variant="danger" onClick={remove} disabled={pending} aria-label={`Remove target ${name}`}>
      {pending ? 'Removing' : 'Remove'}
    </Button>
  );
}
