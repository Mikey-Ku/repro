import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui';

export default function ProjectNotFound() {
  return (
    <Card className="mx-auto mt-8 max-w-xl">
      <CardHeader title="Not found" description="This session, incident or test does not exist in this project." />
      <CardBody className="text-sm">
        <Link href="/">Back to the overview</Link>
      </CardBody>
    </Card>
  );
}
