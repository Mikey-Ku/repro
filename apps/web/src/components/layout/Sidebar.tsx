'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { IconClose, IconIncidents, IconMenu, IconOverview, IconSessions, IconSettings } from '@/components/icons';
import { cn } from '@/lib/cn';
import { projectPath } from '@/lib/paths';

/**
 * Project navigation. A fixed sidebar from the md breakpoint up; below that a
 * top bar with a menu button that reveals the same list. Choosing a link closes
 * the menu so a tap does not leave it hanging open over the new page.
 */
export function Sidebar({ slug, projectName, status }: { slug: string; projectName: string; status: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const items = [
    { href: projectPath(slug), label: 'Overview', icon: IconOverview, exact: true },
    { href: projectPath(slug, 'sessions'), label: 'Sessions', icon: IconSessions },
    { href: projectPath(slug, 'incidents'), label: 'Incidents', icon: IconIncidents },
    { href: projectPath(slug, 'settings'), label: 'Settings', icon: IconSettings },
  ];

  const isCurrent = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav aria-label="Project" className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const current = isCurrent(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              'flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm hover:no-underline',
              current ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
            )}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Small screens: top bar. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-3 py-2 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-raised text-text"
        >
          {open ? <IconClose size={18} /> : <IconMenu size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <Brand projectName={projectName} />
        </div>
        {status}
      </header>
      <div id={menuId} hidden={!open} className="border-b border-border bg-surface px-3 py-2 md:hidden">
        {nav}
      </div>

      {/* md and up: left sidebar. */}
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border bg-surface px-3 py-4 md:flex">
        <Brand projectName={projectName} />
        {nav}
        <div className="mt-auto">{status}</div>
      </aside>
    </>
  );
}

function Brand({ projectName }: { projectName: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded bg-accent font-mono text-xs font-bold text-background">
        R
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-2xs font-semibold tracking-wider text-muted uppercase">Repro</p>
        <p className="truncate text-sm font-semibold text-text">{projectName}</p>
      </div>
    </div>
  );
}
