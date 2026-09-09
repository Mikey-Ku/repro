import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const KEY_PREFIX = 'rp';

/** Generate a new ingestion key. Only the hash is stored; the plaintext is shown once. */
export function generateIngestionKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString('base64url');
  const key = `${KEY_PREFIX}_${secret}`;
  return { key, prefix: keyPrefix(key), hash: hashIngestionKey(key) };
}

export function keyPrefix(key: string): string {
  return key.slice(0, 11);
}

export function hashIngestionKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function keyMatchesHash(key: string, hash: string): boolean {
  const a = Buffer.from(hashIngestionKey(key), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function looksLikeIngestionKey(value: string): boolean {
  return /^rp_[A-Za-z0-9_-]{20,64}$/.test(value);
}
