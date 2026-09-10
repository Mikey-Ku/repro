import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cn('rounded-lg border border-border bg-surface', className)}>{children}</Tag>;
}

export function CardHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold text-text">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn(padded && 'px-4 py-3', className)}>{children}</div>;
}
