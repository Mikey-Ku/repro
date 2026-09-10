import { Skeleton } from '@/components/ui';

export default function RootLoading() {
  return (
    <main id="main" className="px-4 py-8" aria-busy="true" aria-label="Loading">
      <Skeleton className="mx-auto h-24 max-w-xl" />
    </main>
  );
}
