'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  /** Small count or status rendered after the label. */
  badge?: ReactNode;
  content: ReactNode;
}

/**
 * WAI-ARIA tabs with a roving tabindex: only the selected tab is in the tab
 * order, arrow keys move between tabs, Home and End jump to the ends.
 * Panels stay mounted so the player and forms keep their state when switching.
 */
export function Tabs({ tabs, defaultTab, label, className }: { tabs: TabItem[]; defaultTab?: string; label: string; className?: string }) {
  const baseId = useId();
  const initial = tabs.some((tab) => tab.id === defaultTab) ? defaultTab! : tabs[0]?.id;
  const [selected, setSelected] = useState<string | undefined>(initial);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const focusTab = (id: string) => {
    setSelected(id);
    tabRefs.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (target) focusTab(target.id);
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2">
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'relative -mb-px flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-xs font-medium transition-colors',
                isSelected ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== selected}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-2px]"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
