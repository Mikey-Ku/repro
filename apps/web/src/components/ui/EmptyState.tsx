import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function EmptyState({ title, description, action, className, compact }: { title: string; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? <div className="mt-1 max-w-md text-xs leading-relaxed text-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
