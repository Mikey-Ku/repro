import { gzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { decodeBody, registerBodyParsing } from '../../src/plugins/body.js';
import { registerErrorHandling } from '../../src/plugins/errors.js';

const json = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `not-an-AppError: ${String(error)}`;
  }
}

describe('decodeBody', () => {
  it('parses identity and gzip bodies to the same value', () => {
    const value = { hello: 'world', n: [1, 2, 3] };
    expect(decodeBody(json(value), undefined, 1000)).toEqual(value);
    expect(decodeBody(json(value), 'identity', 1000)).toEqual(value);
    expect(decodeBody(gzipSync(json(value)), 'gzip', 1000)).toEqual(value);
    expect(decodeBody(gzipSync(json(value)), 'GZIP', 1000)).toEqual(value);
  });

  it('returns undefined for an empty body', () => {
    expect(decodeBody(Buffer.alloc(0), undefined, 1000)).toBeUndefined();
    expect(decodeBody(Buffer.alloc(0), 'gzip', 1000)).toBeUndefined();
  });

  it('caps the decompressed size, not just the wire size', () => {
    // 200 KB of zeros gzips to a few hundred bytes: a small body that expands past the cap.
    const bomb = gzipSync(Buffer.alloc(200_000, 0x30));
    expect(bomb.length).toBeLessThan(1000);
    expect(codeOf(() => decodeBody(bomb, 'gzip', 100_000))).toBe('payload_too_large');
    expect(codeOf(() => decodeBody(Buffer.alloc(101, 0x30), undefined, 100))).toBe('payload_too_large');
    // Exactly at the cap is allowed.
    expect(decodeBody(Buffer.from('1'.repeat(100)), undefined, 100)).toBe(Number('1'.repeat(100)));
  });

  it('rejects unknown encodings, corrupt gzip and invalid JSON with the documented codes', () => {
    expect(codeOf(() => decodeBody(json({}), 'br', 1000))).toBe('unsupported_encoding');
    expect(codeOf(() => decodeBody(json({}), 'deflate', 1000))).toBe('unsupported_encoding');
    expect(codeOf(() => decodeBody(Buffer.from('not gzip'), 'gzip', 1000))).toBe('validation_failed');
    expect(codeOf(() => decodeBody(Buffer.from('{oops'), undefined, 1000))).toBe('validation_failed');
  });
});

describe('registerBodyParsing', () => {
  async function build(maxBytes: number) {
    const app = Fastify();
    registerBodyParsing(app, maxBytes);
    registerErrorHandling(app);
    app.post('/echo', async (request) => ({ body: request.body ?? null }));
    await app.ready();
    return app;
  }

  it('decodes gzip and text/plain bodies through Fastify', async () => {
    const app = await build(10_000);
    const gz = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: gzipSync(json({ a: 1 })),
    });
    expect(gz.statusCode).toBe(200);
    expect(gz.json()).toEqual({ body: { a: 1 } });

    const text = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'text/plain' }, payload: '{"b":2}' });
    expect(text.json()).toEqual({ body: { b: 2 } });
    await app.close();
  });

  it('answers 413 and 415 in the API error shape', async () => {
    const app = await build(50);
    const big = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: json({ x: 'y'.repeat(100) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ ok: false, error: { code: 'payload_too_large' } });

    const br = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json', 'content-encoding': 'br' }, payload: json({}) });
    expect(br.statusCode).toBe(415);
    expect(br.json()).toMatchObject({ ok: false, error: { code: 'unsupported_encoding' } });
    await app.close();
  });
});
