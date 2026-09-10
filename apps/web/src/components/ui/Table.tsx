import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Thin wrappers over native table elements. Native tables keep the screen
 * reader semantics we want; the wrapper only adds horizontal scrolling and density.
 */
export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, numeric, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cn(numeric && 'text-right', className)} {...rest} />;
}

export function Td({ className, numeric, mono, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; mono?: boolean }) {
  return <td className={cn(numeric && 'text-right tabular-nums', mono && 'font-mono text-xs', className)} {...rest} />;
}
