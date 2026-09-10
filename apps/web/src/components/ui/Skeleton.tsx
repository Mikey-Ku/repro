import { cn } from '@/lib/cn';

/** Grey block that stands in for content while a server component streams. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-raised', className)} />;
}

export function SkeletonRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, col) => (
            <Skeleton key={col} className={cn('h-3.5', col === 0 ? 'w-32' : 'w-20')} />
          ))}
        </div>
      ))}
    </div>
  );
}
