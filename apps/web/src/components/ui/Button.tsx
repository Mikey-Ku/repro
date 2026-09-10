import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-background hover:bg-accent/90 border-transparent font-semibold',
  secondary: 'bg-raised text-text hover:bg-border border-border',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-raised border-transparent',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border-danger/30',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'inline-flex items-center justify-center rounded-md border whitespace-nowrap select-none transition-colors',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-raised',
    'min-h-6 min-w-6',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}

/** A link styled as a button. Used for downloads and navigation actions. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  external,
  download,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  external?: boolean;
  download?: boolean;
}) {
  const classes = cn(buttonClasses(variant, size, className), 'hover:no-underline');
  if (external || download) {
    return (
      <a href={href} className={classes} download={download} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
