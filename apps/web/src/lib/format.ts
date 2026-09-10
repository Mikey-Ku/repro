/**
 * Pure formatting helpers shared by server and client components.
 * No React, no DOM, so they are trivially unit-testable.
 */

/** Milliseconds since session start as mm:ss.mmm (hours roll into minutes). */
export function formatOffset(offsetMs: number): string {
  const safe = Number.isFinite(offsetMs) ? Math.max(0, Math.round(offsetMs)) : 0;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Compact human duration: 850 ms, 4.2 s, 3m 12s, 1h 04m. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

const absolute = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** Fixed UTC timestamp, so server and client render the same text (no hydration drift). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${absolute.format(date)} UTC`;
}

/** "3 min ago" style relative time. `now` is injectable for deterministic rendering. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDateTime(iso);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** First eight characters of an id, the same shorthand the API uses in file names. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Browser name plus major version, e.g. "Chrome 128". */
export function formatBrowser(name: string | null, version: string | null): string {
  if (!name) return 'Unknown';
  const major = version?.split('.')[0];
  return major ? `${name} ${major}` : name;
}
