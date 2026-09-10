import { gunzipSync, gzipSync } from 'node:zlib';
import { asc, eq } from 'drizzle-orm';
import type { RecordedEvent, RecordedEventType } from '@repro/contracts';
import { eventChunks, type Db } from '@repro/db';

/** Chunk payloads are gzip of the JSON array of events. Stored inline in Postgres for now. */
export function encodeChunk(events: readonly RecordedEvent[]): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(events), 'utf8'));
}

export function decodeChunk(payload: Buffer): RecordedEvent[] {
  const parsed: unknown = JSON.parse(gunzipSync(payload).toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error('Chunk payload is not an event array');
  // Payloads were validated and sanitised on ingest; this service is the only writer.
  return parsed as RecordedEvent[];
}

/**
 * Merge many chunks into one ordered, deduplicated event stream.
 * Chunks may arrive out of order (batch 2 before batch 1), so ordering by `seq` is done here,
 * not assumed from storage order. The first event seen for a `seq` wins.
 */
export function mergeEvents(chunks: readonly RecordedEvent[][]): RecordedEvent[] {
  const bySeq = new Map<number, RecordedEvent>();
  for (const events of chunks) {
    for (const event of events) {
      if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Load every event for a session, ordered by seq and deduplicated. Optionally filtered by type. */
export async function loadSessionEvents(db: Db, sessionId: string, types?: readonly RecordedEventType[]): Promise<RecordedEvent[]> {
  const rows = await db
    .select({ payload: eventChunks.payload, encoding: eventChunks.encoding })
    .from(eventChunks)
    .where(eq(eventChunks.sessionId, sessionId))
    .orderBy(asc(eventChunks.batchSeq));
  const decoded = rows.map((row) => (row.payload ? decodeChunk(row.payload) : []));
  const merged = mergeEvents(decoded);
  if (!types || types.length === 0) return merged;
  const wanted = new Set<string>(types);
  return merged.filter((event) => wanted.has(event.type));
}
