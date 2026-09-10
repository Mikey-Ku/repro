'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import type { eventWithTime } from '@rrweb/types';
import type rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { usePlayerControls } from './PlayerContext';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { apiPath } from '@/lib/paths';

/**
 * rrweb replay. The events come through a same-origin proxy route so the
 * internal token never reaches the browser.
 *
 * Security note: rrweb 2 rebuilds the recorded DOM inside an iframe whose
 * sandbox attribute is exactly "allow-same-origin" (no allow-scripts). Scripts
 * recorded from the user's page can never run here; the replayer only
 * reconstructs DOM nodes. We deliberately pass no iframe attributes and never
 * touch the sandbox list, and rrweb refuses to rebuild into anything else.
 */

type Status = { kind: 'loading' } | { kind: 'empty' } | { kind: 'error'; message: string } | { kind: 'ready' };

/**
 * rrweb-player is a Svelte 4 component. Its type declarations reference the
 * svelte package, which is not installed here, so the two instance methods we
 * need from the Svelte base class are declared explicitly.
 */
type Player = rrwebPlayer & {
  $set(props: { width?: number; height?: number }): void;
  $destroy(): void;
};

interface Props {
  slug: string;
  sessionId: string;
  /** Session start as epoch milliseconds; timeline offsets are relative to it. */
  startedAtMs: number;
  /** Recorded viewport, used to pick the player's aspect ratio. */
  viewport: { width: number | null; height: number | null };
}

async function fetchRrwebEvents(slug: string, sessionId: string, signal: AbortSignal): Promise<eventWithTime[]> {
  const response = await fetch(`${apiPath(slug, 'sessions', sessionId, 'events')}?types=rrweb`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Events request failed with status ${response.status}`);
  const body = (await response.json()) as { events?: Array<{ type?: string; data?: unknown }> };
  if (!Array.isArray(body.events)) throw new Error('Events response had no events array');
  // The contract keeps rrweb payloads opaque (validated only as an object with type and timestamp).
  // The replayer owns the real shape, so this is the one cast in the dashboard.
  return body.events.filter((event) => event.type === 'rrweb').map((event) => event.data as eventWithTime);
}

export function ReplayPlayer(props: Props) {
  return (
    <PlayerErrorBoundary>
      <ReplayPlayerInner {...props} />
    </PlayerErrorBoundary>
  );
}

function ReplayPlayerInner({ slug, sessionId, startedAtMs, viewport }: Props) {
  const controls = usePlayerControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Step 1: load the rrweb events. The status starts as loading and the retry
  // button resets it, so the effect itself only reports outcomes.
  useEffect(() => {
    const abort = new AbortController();
    fetchRrwebEvents(slug, sessionId, abort.signal)
      .then((loaded) => {
        if (abort.signal.aborted) return;
        // rrweb needs at least a meta event and a full snapshot to render anything.
        if (loaded.length < 2) {
          setStatus({ kind: 'empty' });
          return;
        }
        setEvents(loaded);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to load replay' });
      });
    return () => abort.abort();
  }, [slug, sessionId, attempt]);

  // Step 2: mount the player once events exist. rrweb-player touches window at
  // import time, so it is imported here rather than at module level.
  useEffect(() => {
    if (!events || !mountRef.current || !containerRef.current) return;
    const mount = mountRef.current;
    const container = containerRef.current;
    let cancelled = false;
    let player: Player | null = null;
    let unregister: (() => void) | null = null;
    let lastReport = 0;

    // Timeline offsets are measured from the session start; the player measures
    // from its first event. The difference is constant for the whole session.
    const firstTs = events[0]?.timestamp ?? startedAtMs;
    const delta = startedAtMs - firstTs;
    const toPlayerTime = (offsetMs: number) => Math.max(0, offsetMs + delta);
    const toSessionOffset = (playerMs: number) => Math.max(0, playerMs - delta);

    const size = () => {
      const width = Math.max(320, Math.floor(container.clientWidth));
      const ratio = viewport.width && viewport.height ? viewport.height / viewport.width : 9 / 16;
      // Controller bar is roughly 80px tall; keep the whole player inside the column.
      const height = Math.min(Math.round(width * ratio), Math.max(240, window.innerHeight - 260));
      return { width, height };
    };

    import('rrweb-player')
      .then(({ default: RrwebPlayer }) => {
        if (cancelled) return;
        mount.replaceChildren();
        const { width, height } = size();
        player = new RrwebPlayer({
          target: mount,
          props: { events, autoPlay: false, showController: true, width, height, skipInactive: true, mouseTail: false },
        }) as Player;

        let playing = false;
        player.addEventListener('ui-update-player-state', (detail) => {
          const state = (detail as { payload?: string } | undefined)?.payload;
          playing = state === 'playing';
          const replayer = player?.getReplayer();
          if (replayer) controls.reportTime(toSessionOffset(replayer.getCurrentTime()), playing);
        });
        player.addEventListener('ui-update-current-time', (detail) => {
          const payload = (detail as { payload?: number } | undefined)?.payload;
          if (typeof payload !== 'number') return;
          // The player emits on every frame; four updates a second is plenty for row highlighting.
          const now = Date.now();
          if (playing && now - lastReport < 250) return;
          lastReport = now;
          controls.reportTime(toSessionOffset(payload), playing);
        });

        unregister = controls.register({
          seek(offsetMs) {
            player?.goto(toPlayerTime(offsetMs), false);
          },
        });
        setStatus({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to start the player' });
      });

    const observer = new ResizeObserver(() => {
      if (!player) return;
      const next = size();
      player.$set(next);
      player.triggerResize();
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      unregister?.();
      if (player) {
        try {
          player.pause();
          player.$destroy();
        } catch {
          // The player may already be gone if the iframe was detached.
        }
      }
      mount.replaceChildren();
    };
  }, [events, startedAtMs, viewport.width, viewport.height, controls]);

  return (
    <div ref={containerRef} className="min-w-0">
      {status.kind === 'loading' ? (
        <div aria-busy="true" aria-label="Loading replay" className="space-y-2">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}
      {status.kind === 'empty' ? (
        <EmptyState title="No replay data was captured for this session" description="The SDK records DOM snapshots with rrweb. Sessions started with recording disabled, or cut off before the first snapshot, have no replay." />
      ) : null}
      {status.kind === 'error' ? (
        <EmptyState
          title="Replay failed to load"
          description={status.message}
          action={
            <Button
              onClick={() => {
                setEvents(null);
                setStatus({ kind: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          }
        />
      ) : null}
      {/* Always mounted so the effect above has a target; hidden until the player is ready. */}
      <div ref={mountRef} className={status.kind === 'ready' ? 'replay-mount' : 'hidden'} aria-label="Session replay" />
    </div>
  );
}

/** Class component because React still has no hook for catching render errors. */
class PlayerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <EmptyState
          title="The replay player crashed"
          description={this.state.error.message}
          action={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}
        />
      );
    }
    return this.props.children;
  }
}
