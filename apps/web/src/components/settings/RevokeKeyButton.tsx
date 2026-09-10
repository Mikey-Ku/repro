'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui';
import { revokeKeyAction } from '@/lib/actions';

/** Revocation is permanent, so a native confirm() guards it. The action runs in a transition to keep the row responsive. */
export function RevokeKeyButton({ slug, keyId, label }: { slug: string; keyId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const revoke = () => {
    if (!window.confirm(`Revoke the key "${label}"? Applications using it will stop recording immediately.`)) return;
    startTransition(async () => {
      await revokeKeyAction(slug, keyId);
    });
  };
  return (
    <Button size="sm" variant="danger" onClick={revoke} disabled={pending} aria-label={`Revoke key ${label}`}>
      {pending ? 'Revoking' : 'Revoke'}
    </Button>
  );
}
