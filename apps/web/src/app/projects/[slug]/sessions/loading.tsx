import { Skeleton, SkeletonRows } from '@/components/ui';

export default function SessionsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading sessions">
      <Skeleton className="mb-4 h-7 w-32" />
      <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <SkeletonRows rows={10} columns={9} />
      </div>
    </div>
  );
}
