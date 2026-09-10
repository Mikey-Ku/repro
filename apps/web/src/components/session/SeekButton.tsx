'use client';

import type { EvidenceRef } from '@repro/contracts';
import { usePlayerControls } from './PlayerContext';
import { formatOffset } from '@/lib/format';

/** "@ mm:ss.mmm" button that seeks the replay to an evidence reference. */
export function SeekButton({ offsetMs, seq, label }: { offsetMs: number; seq?: number; label?: string }) {
  const { seekTo } = usePlayerControls();
  return (
    <button
      type="button"
      onClick={() => seekTo(offsetMs, seq ?? null)}
      title={label ? `Seek to ${label}` : 'Seek replay'}
      className="inline-flex min-h-6 items-center rounded border border-border bg-raised px-1.5 font-mono text-2xs text-accent hover:border-accent/60"
    >
      @ {formatOffset(offsetMs)}
    </button>
  );
}

export function RefButton({ evidenceRef }: { evidenceRef: EvidenceRef }) {
  return <SeekButton offsetMs={evidenceRef.offsetMs} seq={evidenceRef.seq} label={evidenceRef.label} />;
}
