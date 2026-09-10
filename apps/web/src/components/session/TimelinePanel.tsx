'use client';

import { useMemo, useState } from 'react';
import { usePlayerControls, usePlayerTime } from './PlayerContext';
import { IconClick, IconConsole, IconError, IconInput, IconNavigate, IconNetwork, IconTag, IconUser } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatOffset } from '@/lib/format';
import type { TimelineEntry } from '@/lib/schemas';

/**
 * Unified timeline. Each row is a button: activating it seeks the replay and
 * marks the row. The row whose offset the playhead has passed is highlighted
 * as playback advances. Every string from the recording is rendered as React
 * text, never as HTML, so a recorded value cannot inject markup here.
 */

type Group = 'interaction' | 'navigation' | 'error' | 'console' | 'network';

const GROUPS: Array<{ id: Group; label: string }> = [
  { id: 'interaction', label: 'Interactions' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'error', label: 'Errors' },
  { id: 'console', label: 'Console' },
  { id: 'network', label: 'Network' },
];

/** Annotations and identify calls come from application code, so they count as interactions. */
export function groupOf(kind: TimelineEntry['kind']): Group {
  switch (kind) {
    case 'click':
    case 'input':
    case 'submit':
    case 'annotation':
    case 'identify':
      return 'interaction';
    default:
      return kind;
  }
}

const ICONS: Record<TimelineEntry['kind'], typeof IconClick> = {
  click: IconClick,
  input: IconInput,
  submit: IconInput,
  navigation: IconNavigate,
  error: IconError,
  console: IconConsole,
  network: IconNetwork,
  annotation: IconTag,
  identify: IconUser,
};

const SEVERITY: Record<TimelineEntry['severity'], string> = {
  info: 'text-muted',
  warn: 'text-warning',
  error: 'text-danger',
};

export function TimelinePanel({ entries }: { entries: TimelineEntry[] }) {
  const [enabled, setEnabled] = useState<Set<Group>>(() => new Set(GROUPS.map((group) => group.id)));
  const { seekTo } = usePlayerControls();
  const { currentMs, activeSeq } = usePlayerTime();

  const counts = useMemo(() => {
    const result: Record<Group, number> = { interaction: 0, navigation: 0, error: 0, console: 0, network: 0 };
    for (const entry of entries) result[groupOf(entry.kind)] += 1;
    return result;
  }, [entries]);

  const visible = useMemo(() => entries.filter((entry) => enabled.has(groupOf(entry.kind))), [entries, enabled]);

  // The "current" row is the last visible one at or before the playhead.
  const currentSeq = useMemo(() => {
    let found: number | null = null;
    for (const entry of visible) {
      if (entry.offsetMs <= currentMs) found = entry.seq;
      else break;
    }
    return found;
  }, [visible, currentMs]);

  const toggle = (group: Group) => {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (!entries.length) {
    return <EmptyState compact title="No events" description="Only rrweb snapshots were captured, or the session has no interactions yet." />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div role="group" aria-label="Filter timeline" className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {GROUPS.map((group) => {
          const on = enabled.has(group.id);
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(group.id)}
              className={cn(
                'inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-2xs font-medium',
                on ? 'border-accent/50 bg-accent/15 text-text' : 'border-border bg-transparent text-muted hover:text-text',
              )}
            >
              {group.label}
              <span className="font-mono opacity-70">{counts[group.id]}</span>
            </button>
          );
        })}
      </div>
      {visible.length ? (
        <ol className="divide-y divide-border">
          {visible.map((entry) => {
            const Icon = ICONS[entry.kind];
            const isActive = activeSeq === entry.seq;
            const isCurrent = currentSeq === entry.seq;
            const stack = entry.kind === 'error' ? entry.detail : undefined;
            const detail = entry.kind === 'error' ? undefined : entry.detail;
            return (
              <li key={entry.seq} className={cn(isCurrent && 'bg-raised', isActive && 'bg-accent/10')} aria-current={isCurrent ? 'time' : undefined}>
                <button
                  type="button"
                  onClick={() => seekTo(entry.offsetMs, entry.seq)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-raised focus-visible:outline-offset-[-2px]"
                >
                  <span className="w-20 shrink-0 pt-px font-mono text-2xs text-accent tabular-nums">{formatOffset(entry.offsetMs)}</span>
                  <Icon size={14} className={cn('mt-0.5 shrink-0', SEVERITY[entry.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-xs', entry.severity === 'error' ? 'text-danger' : 'text-text')} title={entry.title}>
                      {entry.severity !== 'info' ? <span className="sr-only">{entry.severity === 'error' ? 'Error: ' : 'Warning: '}</span> : null}
                      {entry.title}
                    </span>
                    {detail ? (
                      <span className="block truncate font-mono text-2xs text-muted" title={detail}>
                        {detail}
                      </span>
                    ) : null}
                  </span>
                </button>
                {stack ? (
                  <details className="px-3 pb-2">
                    <summary className="cursor-pointer text-2xs text-muted select-none">Stack trace</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-background px-2 py-1 text-2xs text-muted">{stack}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState compact title="Nothing to show" description="Every kind is filtered out. Turn a filter back on." />
      )}
    </div>
  );
}
