import { gunzipSync } from 'node:zlib';
import { asc, eq } from 'drizzle-orm';
import type { RecordedEvent } from '@repro/contracts';
import { eventChunks, type Db } from '@repro/db';

/** A chunk payload is gzip of the JSON array of events the SDK uploaded in one batch. */
export function decodeChunk(payload: Buffer): RecordedEvent[] {
  const parsed: unknown = JSON.parse(gunzipSync(payload).toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error('Chunk payload is not an event array');
  // The ingest API validated and sanitised every event before storing it, and it is the only writer.
  return parsed as RecordedEvent[];
}

/**
 * Merge chunks into one ordered, deduplicated stream. The SDK retries uploads, so the same event
 * can sit in two chunks; the first occurrence (lowest batchSeq, since chunks arrive in that order)
 * wins. Ordering by `seq` is done here because batches can be stored out of order.
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

/** Every event of a session, ordered by seq and deduplicated. */
export async function loadSessionEvents(db: Db, sessionId: string): Promise<RecordedEvent[]> {
  const rows = await db
    .select({ payload: eventChunks.payload, encoding: eventChunks.encoding, batchSeq: eventChunks.batchSeq })
    .from(eventChunks)
    .where(eq(eventChunks.sessionId, sessionId))
    .orderBy(asc(eventChunks.batchSeq));
  const decoded = rows.map((row) => {
    if (!row.payload) return [];
    if (row.encoding !== 'gzip') throw new Error(`Unsupported chunk encoding "${row.encoding}" (batch ${row.batchSeq})`);
    return decodeChunk(row.payload);
  });
  return mergeEvents(decoded);
}
