import { Skeleton, SkeletonRows } from '@/components/ui';

export default function SessionLoading() {
  return (
    <div aria-busy="true" aria-label="Loading session">
      <div className="mb-3 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 rounded-lg border border-border bg-surface p-2 lg:col-span-2">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex gap-2 border-b border-border px-3 py-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-16" />
            ))}
          </div>
          <SkeletonRows rows={8} columns={3} />
        </div>
      </div>
    </div>
  );
}
