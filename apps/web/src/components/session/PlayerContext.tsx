'use client';

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Shared state between the replay player and everything that points into it
 * (timeline rows, evidence refs, jump-to-error, the ?t= search param).
 *
 * Two contexts on purpose: the controls never change identity, so a seek
 * button never re-renders because the clock ticked; only components that
 * display the current time subscribe to the time context.
 */

export interface PlayerHandle {
  /** Seek to a session offset in milliseconds and pause there. */
  seek(offsetMs: number): void;
}

export interface PlayerControls {
  /** Seek the player. `seq` marks the timeline row that requested it, for highlighting. */
  seekTo(offsetMs: number, seq?: number | null): void;
  /** Called by the player once it is mounted. Returns an unregister function. */
  register(handle: PlayerHandle): () => void;
  /** Called by the player as playback advances. */
  reportTime(offsetMs: number, playing: boolean): void;
}

export interface PlayerTime {
  currentMs: number;
  playing: boolean;
  /** Seq of the last row that seeked, cleared when playback resumes. */
  activeSeq: number | null;
}

const ControlsContext = createContext<PlayerControls | null>(null);
const TimeContext = createContext<PlayerTime>({ currentMs: 0, playing: false, activeSeq: null });

export function PlayerProvider({ initialOffsetMs = null, children }: { initialOffsetMs?: number | null; children: ReactNode }) {
  const handleRef = useRef<PlayerHandle | null>(null);
  // A seek requested before the player exists (for example from ?t=) waits here.
  const pendingRef = useRef<number | null>(initialOffsetMs);
  const [time, setTime] = useState<PlayerTime>({ currentMs: initialOffsetMs ?? 0, playing: false, activeSeq: null });

  const controls = useMemo<PlayerControls>(
    () => ({
      seekTo(offsetMs, seq = null) {
        const safe = Math.max(0, Math.round(offsetMs));
        setTime((previous) => ({ ...previous, currentMs: safe, playing: false, activeSeq: seq }));
        if (handleRef.current) handleRef.current.seek(safe);
        else pendingRef.current = safe;
      },
      register(handle) {
        handleRef.current = handle;
        if (pendingRef.current !== null) {
          handle.seek(pendingRef.current);
          pendingRef.current = null;
        }
        return () => {
          if (handleRef.current === handle) handleRef.current = null;
        };
      },
      reportTime(offsetMs, playing) {
        const safe = Math.max(0, Math.round(offsetMs));
        setTime((previous) => {
          if (previous.currentMs === safe && previous.playing === playing) return previous;
          return { currentMs: safe, playing, activeSeq: playing ? null : previous.activeSeq };
        });
      },
    }),
    [],
  );

  return (
    <ControlsContext.Provider value={controls}>
      <TimeContext.Provider value={time}>{children}</TimeContext.Provider>
    </ControlsContext.Provider>
  );
}

export function usePlayerControls(): PlayerControls {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error('usePlayerControls must be used inside <PlayerProvider>');
  return controls;
}

export function usePlayerTime(): PlayerTime {
  return useContext(TimeContext);
}

/** Test helper: a provider with a spy in place of the real controls. */
export function PlayerControlsForTests({ controls, children }: { controls: PlayerControls; children: ReactNode }) {
  return <ControlsContext.Provider value={controls}>{children}</ControlsContext.Provider>;
}
