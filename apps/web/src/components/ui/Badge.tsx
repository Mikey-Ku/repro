import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted border-border',
  accent: 'bg-accent/15 text-accent border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-2xs font-medium uppercase tracking-wide whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Colour mapping shared by every status-like value in the product. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'passed':
    case 'completed':
    case 'resolved':
    case 'ok':
      return 'success';
    case 'failed':
    case 'error':
    case 'timeout':
    case 'expired':
      return 'danger';
    case 'running':
    case 'recording':
    case 'queued':
      return 'accent';
    case 'open':
      return 'warning';
    default:
      return 'neutral';
  }
}
