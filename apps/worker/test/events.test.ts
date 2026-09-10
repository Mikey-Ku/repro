import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { RecordedEvent } from '@repro/contracts';
import { decodeChunk, mergeEvents } from '../src/events.js';

const nav = (seq: number, url: string): RecordedEvent => ({
  seq,
  ts: 1_700_000_000_000 + seq,
  type: 'navigation',
  data: { url, kind: 'load' },
});

const gzip = (events: RecordedEvent[]) => gzipSync(Buffer.from(JSON.stringify(events), 'utf8'));

describe('decodeChunk', () => {
  it('gunzips and parses an event array', () => {
    const events = [nav(0, 'http://localhost:4100/login'), nav(1, 'http://localhost:4100/checkout')];
    expect(decodeChunk(gzip(events))).toEqual(events);
  });

  it('rejects a payload that is not an array', () => {
    expect(() => decodeChunk(gzipSync(Buffer.from('{"nope":true}')))).toThrow(/not an event array/);
  });

  it('rejects bytes that are not gzip', () => {
    expect(() => decodeChunk(Buffer.from('plain text'))).toThrow();
  });
});

describe('mergeEvents', () => {
  it('orders by seq across chunks that were stored out of order', () => {
    const merged = mergeEvents([[nav(3, '/c'), nav(4, '/d')], [nav(0, '/a'), nav(1, '/b')]]);
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 3, 4]);
  });

  it('keeps the first occurrence of a duplicated seq', () => {
    const first = nav(2, '/first');
    const retry = nav(2, '/retry');
    const merged = mergeEvents([[nav(1, '/a'), first], [retry, nav(3, '/c')]]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(merged[1]).toBe(first);
  });

  it('returns an empty list for no chunks', () => {
    expect(mergeEvents([])).toEqual([]);
  });
});
