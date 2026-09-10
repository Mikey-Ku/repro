import { Skeleton, SkeletonRows } from '@/components/ui';

export default function ProjectLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}
