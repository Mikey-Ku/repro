import { gunzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';

/** Content types the SDK sends: fetch uses JSON, sendBeacon can only send text/plain. */
export const ACCEPTED_CONTENT_TYPES = ['application/json', 'text/plain'] as const;

/**
 * Turn a raw request body into parsed JSON, honouring `content-encoding: gzip`.
 * The decompressed size is capped independently of the raw body limit so a small gzip
 * bomb cannot expand past `maxBytes`. Returns `undefined` for an empty body so routes can
 * treat "no body" the same as `{}` where that makes sense.
 */
export function decodeBody(raw: Buffer, contentEncoding: string | undefined, maxBytes: number): unknown {
  const encoding = (contentEncoding ?? 'identity').trim().toLowerCase();
  let bytes: Buffer;
  if (encoding === 'identity' || encoding === '') {
    bytes = raw;
  } else if (encoding === 'gzip' || encoding === 'x-gzip') {
    if (raw.length === 0) return undefined;
    try {
      // maxOutputLength makes zlib stop early instead of allocating the whole expansion.
      bytes = gunzipSync(raw, { maxOutputLength: maxBytes + 1 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ERR_BUFFER_TOO_LARGE') {
        throw new AppError('payload_too_large', `Decompressed body exceeds ${maxBytes} bytes`);
      }
      throw new AppError('validation_failed', 'Body is not valid gzip data');
    }
  } else {
    throw new AppError('unsupported_encoding', `Unsupported content-encoding "${encoding}"; use identity or gzip`);
  }
  if (bytes.length > maxBytes) {
    throw new AppError('payload_too_large', `Body exceeds ${maxBytes} bytes`);
  }
  if (bytes.length === 0) return undefined;
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new AppError('validation_failed', 'Body is not valid JSON');
  }
}

/**
 * Replace Fastify's default JSON and text parsers with one that reads the body as a buffer,
 * gunzips when asked, and enforces the batch size cap after decompression.
 */
export function registerBodyParsing(app: FastifyInstance, maxBatchBytes: number): void {
  app.removeContentTypeParser([...ACCEPTED_CONTENT_TYPES]);
  app.addContentTypeParser(
    [...ACCEPTED_CONTENT_TYPES],
    { parseAs: 'buffer', bodyLimit: maxBatchBytes },
    async (request: FastifyRequest, body: Buffer) => decodeBody(body, request.headers['content-encoding'], maxBatchBytes),
  );
}
