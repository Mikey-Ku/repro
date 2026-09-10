import Link from 'next/link';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

export function StatTile({ label, value, hint, href, tone }: { label: string; value: number; hint?: string; href?: string; tone?: 'danger' | 'warning' }) {
  const body = (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', tone === 'danger' && value > 0 && 'text-danger', tone === 'warning' && value > 0 && 'text-warning')}>
        {formatNumber(value)}
      </dd>
      {hint ? <dd className="mt-0.5 text-2xs text-muted">{hint}</dd> : null}
    </>
  );
  const classes = 'block rounded-lg border border-border bg-surface px-4 py-3';
  if (href) {
    return (
      <Link href={href} className={cn(classes, 'hover:border-accent/60 hover:no-underline')}>
        <dl className="text-text">{body}</dl>
      </Link>
    );
  }
  return (
    <div className={classes}>
      <dl>{body}</dl>
    </div>
  );
}
