import { generateIngestionKey, keyMatchesHash, looksLikeIngestionKey, type Db } from '@repro/db';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { extractIngestionKey } from '../../src/plugins/auth.js';
import { verifyIngestionKey } from '../../src/services/keys.js';

const requestWith = (headers: Record<string, string>, query: Record<string, unknown> = {}): FastifyRequest =>
  ({ headers, query }) as unknown as FastifyRequest;

describe('extractIngestionKey', () => {
  it('prefers the header, falls back to ?key= for sendBeacon, and ignores empty values', () => {
    expect(extractIngestionKey(requestWith({ 'x-repro-key': 'rp_header' }, { key: 'rp_query' }))).toBe('rp_header');
    expect(extractIngestionKey(requestWith({}, { key: 'rp_query' }))).toBe('rp_query');
    expect(extractIngestionKey(requestWith({ 'x-repro-key': '' }, { key: '' }))).toBeNull();
    expect(extractIngestionKey(requestWith({}, { key: ['a', 'b'] }))).toBeNull();
    expect(extractIngestionKey(requestWith({}))).toBeNull();
  });
});

describe('key format and hashing', () => {
  it('generated keys have the documented shape and verify against their own hash only', () => {
    const a = generateIngestionKey();
    const b = generateIngestionKey();
    expect(looksLikeIngestionKey(a.key)).toBe(true);
    expect(a.prefix).toBe(a.key.slice(0, 11));
    expect(keyMatchesHash(a.key, a.hash)).toBe(true);
    expect(keyMatchesHash(b.key, a.hash)).toBe(false);
    expect(keyMatchesHash(`${a.key}x`, a.hash)).toBe(false);
  });

  it('does not touch the database for keys that cannot be valid', async () => {
    // A db whose every method throws: if verifyIngestionKey queried it, the test would fail.
    const untouchable = new Proxy({} as Db, {
      get() {
        throw new Error('database must not be queried for a malformed key');
      },
    });
    for (const bad of ['', 'nope', 'rp_short', 'ak_prod_abcdefghijklmnopqrstuvwxyz', "rp_'; drop table sessions; --"]) {
      expect(await verifyIngestionKey(untouchable, bad)).toBeNull();
    }
  });
});
