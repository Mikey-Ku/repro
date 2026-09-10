/**
 * Per-tab session persistence. sessionStorage survives full page loads within one tab
 * but not across tabs, which is exactly the "one tab is one session" rule we want.
 * Every access is wrapped because storage can throw (private mode, disabled cookies, quota).
 */
export const SESSION_STORAGE_KEY = 'repro:session';

export interface PersistedSession {
  id: string;
  startedAt: number;
  /** Next event seq to assign. */
  seq: number;
  /** Next batchSeq to assign. */
  batchSeq: number;
  /** False when the sampleRate decision excluded this session. */
  sampled: boolean;
  /** Sanitised page url of the last full load, so meta is re-sent when it changes. */
  url: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): PersistedSession | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (typeof parsed.id !== 'string' || typeof parsed.seq !== 'number' || typeof parsed.batchSeq !== 'number') {
      return null;
    }
    return {
      id: parsed.id,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
      seq: parsed.seq,
      batchSeq: parsed.batchSeq,
      sampled: parsed.sampled !== false,
      url: typeof parsed.url === 'string' ? parsed.url : '',
    };
  } catch {
    return null;
  }
}

export function saveSession(session: PersistedSession): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota or privacy errors are not worth breaking the host page for.
  }
}

export function clearSession(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
