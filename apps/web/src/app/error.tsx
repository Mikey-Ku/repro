'use client';

import { useEffect } from 'react';
import { Button, Card, CardBody, CardHeader } from '@/components/ui';

/** Root error boundary. Client component by Next.js convention; it receives a reset() to retry the render. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="px-4">
      <Card className="mx-auto mt-8 max-w-xl">
        <CardHeader title="Something went wrong" description="The page failed to render." />
        <CardBody className="space-y-3 text-sm">
          <pre className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-danger">{error.message}</pre>
          {error.digest ? <p className="text-2xs text-muted">Digest {error.digest}</p> : null}
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
