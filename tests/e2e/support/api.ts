import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { env } from './env.js';

const headers = { 'x-repro-internal-token': env.internalToken, 'content-type': 'application/json' };

export async function api<T = unknown>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.ingestUrl}${pathname}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function projectBySlug(slug: string): Promise<{ id: string; slug: string }> {
  return api(`/api/projects/by-slug/${slug}`);
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined>, options: { timeoutMs?: number; intervalMs?: number; label?: string } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${options.label ?? 'condition'}${lastError ? `: ${String(lastError)}` : ''}`);
}

/** Read every persisted byte for a session straight from Postgres and return it as text. */
export async function persistedSessionText(sessionId: string): Promise<string> {
  const sql = postgres(env.databaseUrl, { max: 1 });
  try {
    const chunks = await sql<{ payload: Buffer }[]>`SELECT payload FROM event_chunks WHERE session_id = ${sessionId} ORDER BY batch_seq`;
    const session = await sql`SELECT row_to_json(s) AS row FROM sessions s WHERE id = ${sessionId}`;
    const incidents = await sql`SELECT row_to_json(i) AS row FROM incidents i WHERE session_id = ${sessionId}`;
    const findings = await sql`SELECT row_to_json(f) AS row FROM diagnostic_findings f WHERE session_id = ${sessionId}`;
    const tests = await sql`SELECT row_to_json(t) AS row FROM generated_tests t WHERE session_id = ${sessionId}`;
    const parts = [
      ...chunks.map((c) => gunzipSync(c.payload).toString('utf8')),
      ...session.map((r) => JSON.stringify(r.row)),
      ...incidents.map((r) => JSON.stringify(r.row)),
      ...findings.map((r) => JSON.stringify(r.row)),
      ...tests.map((r) => JSON.stringify(r.row)),
    ];
    return parts.join('\n');
  } finally {
    await sql.end();
  }
}

export async function setDemoMode(mode: 'broken' | 'fixed'): Promise<void> {
  const res = await fetch(`${env.demoUrl}/__demo/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (!res.ok) throw new Error(`could not set demo mode: ${res.status}`);
}
