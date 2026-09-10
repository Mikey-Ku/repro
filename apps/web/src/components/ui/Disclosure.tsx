import type { ReactNode } from 'react';
import { IconChevron } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * Native <details> gives us keyboard toggling and screen reader state for free,
 * so this stays a server-renderable component with no JavaScript.
 */
export function Disclosure({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details open={defaultOpen} className={cn('group rounded-md border border-border bg-surface', className)}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs font-medium text-text select-none [&::-webkit-details-marker]:hidden">
        <IconChevron size={14} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
        <span className="flex-1">{summary}</span>
      </summary>
      <div className="border-t border-border px-3 py-2 text-xs">{children}</div>
    </details>
  );
}
