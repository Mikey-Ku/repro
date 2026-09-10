'use client';

import { useEffect } from 'react';
import { Disconnected } from '@/components/layout/Disconnected';
import { Button, Card, CardBody, CardHeader } from '@/components/ui';

/**
 * Error boundary for project pages. The ingest client throws a distinctive
 * name when the service is unreachable; that case gets the disconnected card,
 * everything else gets the message and a retry.
 */
export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = (
    <Button variant="primary" onClick={reset}>
      Try again
    </Button>
  );

  if (error.name === 'ApiUnreachableError' || error.message.startsWith('Could not reach the ingest service')) {
    return <Disconnected action={retry} />;
  }

  return (
    <Card className="mx-auto mt-8 max-w-xl">
      <CardHeader title="Something went wrong" description="This page failed to load." />
      <CardBody className="space-y-3 text-sm">
        <pre className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-danger">{error.message}</pre>
        {error.digest ? <p className="text-2xs text-muted">Digest {error.digest}</p> : null}
        {retry}
      </CardBody>
    </Card>
  );
}
