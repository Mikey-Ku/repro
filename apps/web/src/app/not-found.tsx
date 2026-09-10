import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui';

export default function RootNotFound() {
  return (
    <main id="main" className="px-4">
      <Card className="mx-auto mt-8 max-w-xl">
        <CardHeader title="Not found" description="There is no page or project at this address." />
        <CardBody className="text-sm">
          <Link href="/">Go to the dashboard</Link>
        </CardBody>
      </Card>
    </main>
  );
}
