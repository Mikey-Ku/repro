import { and, desc, eq, isNull } from 'drizzle-orm';
import { generateIngestionKey, ingestionKeys, keyMatchesHash, keyPrefix, looksLikeIngestionKey, type Db, type IngestionKeyRow } from '@repro/db';

/** How often `lastUsedAt` is written per key. One write a minute is plenty for "last seen" in the UI. */
const TOUCH_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

export async function createIngestionKey(db: Db, projectId: string, label: string): Promise<{ row: IngestionKeyRow; key: string }> {
  const generated = generateIngestionKey();
  const [row] = await db
    .insert(ingestionKeys)
    .values({ projectId, label, prefix: generated.prefix, keyHash: generated.hash })
    .returning();
  return { row: row!, key: generated.key };
}

export async function listIngestionKeys(db: Db, projectId: string): Promise<IngestionKeyRow[]> {
  return db.select().from(ingestionKeys).where(eq(ingestionKeys.projectId, projectId)).orderBy(desc(ingestionKeys.createdAt));
}

/** Revoke a key. Returns false when the key does not belong to the project (or does not exist). */
export async function revokeIngestionKey(db: Db, projectId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .update(ingestionKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(ingestionKeys.id, keyId), eq(ingestionKeys.projectId, projectId), isNull(ingestionKeys.revokedAt)))
    .returning({ id: ingestionKeys.id });
  return rows.length > 0;
}

/**
 * Resolve a plaintext key to its row. The prefix narrows the candidates (indexed), then the
 * SHA-256 comparison is constant-time. Revoked keys never match. Updates `lastUsedAt` at most
 * once a minute per key so hot keys do not turn every batch into an extra write.
 */
export async function verifyIngestionKey(db: Db, key: string): Promise<IngestionKeyRow | null> {
  if (!looksLikeIngestionKey(key)) return null;
  const candidates = await db.select().from(ingestionKeys).where(eq(ingestionKeys.prefix, keyPrefix(key)));
  const match = candidates.find((row) => keyMatchesHash(key, row.keyHash));
  if (!match || match.revokedAt) return null;

  const now = Date.now();
  const last = lastTouched.get(match.id) ?? 0;
  if (now - last > TOUCH_INTERVAL_MS) {
    lastTouched.set(match.id, now);
    await db.update(ingestionKeys).set({ lastUsedAt: new Date(now) }).where(eq(ingestionKeys.id, match.id));
    match.lastUsedAt = new Date(now);
  }
  return match;
}

/** Test hook: forget the throttle state so a fresh process is simulated. */
export function resetKeyTouchThrottle(): void {
  lastTouched.clear();
}
