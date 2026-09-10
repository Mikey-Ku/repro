import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/services/sessions.js';

describe('session list cursor', () => {
  it('round-trips startedAt and id', () => {
    const row = { startedAt: new Date('2024-05-01T10:00:00.123Z'), id: '22222222-2222-4222-8222-222222222222' };
    const cursor = encodeCursor(row);
    expect(cursor).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(cursor, 'base64').toString('utf8')).toBe('2024-05-01T10:00:00.123Z|22222222-2222-4222-8222-222222222222');
    expect(decodeCursor(cursor)).toEqual(row);
  });

  it('rejects cursors that are not base64 of a date and a uuid', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('no-separator').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from('not-a-date|22222222-2222-4222-8222-222222222222').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from('2024-05-01T10:00:00.000Z|not-a-uuid').toString('base64'))).toBeNull();
    expect(decodeCursor(Buffer.from("2024-05-01T10:00:00.000Z|' or 1=1").toString('base64'))).toBeNull();
  });
});
