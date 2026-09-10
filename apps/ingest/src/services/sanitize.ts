import { routeFromPath, sanitizePath, sanitizeUrl, scrubText, type IngestBatch, type RecordedEvent, type SessionMeta } from '@repro/contracts';

/**
 * Server-side defence in depth. The SDK already sanitises URLs and scrubs free text before
 * upload, but the server must not trust the client: a modified or outdated SDK must not be
 * able to persist a token in a query string or a bearer header inside an error message.
 * These are the same pure helpers the SDK uses, from @repro/contracts.
 */
export function sanitizeEvent(event: RecordedEvent): RecordedEvent {
  switch (event.type) {
    case 'navigation':
      return { ...event, data: { ...event.data, url: sanitizeUrl(event.data.url) } };
    case 'network':
      return {
        ...event,
        data: {
          ...event.data,
          url: sanitizeUrl(event.data.url),
          path: sanitizePath(event.data.path),
          ...(event.data.error !== undefined ? { error: scrubText(event.data.error) } : {}),
        },
      };
    case 'error':
      return {
        ...event,
        data: {
          ...event.data,
          message: scrubText(event.data.message),
          ...(event.data.stack !== undefined ? { stack: scrubText(event.data.stack) } : {}),
          ...(event.data.source !== undefined ? { source: sanitizeUrl(event.data.source) } : {}),
        },
      };
    case 'console':
      return { ...event, data: { ...event.data, args: event.data.args.map(scrubText) } };
    case 'click':
    case 'input':
    case 'submit':
      // Element descriptors carry hrefs; sanitise those too.
      if (event.data.target.href !== undefined) {
        return { ...event, data: { ...event.data, target: { ...event.data.target, href: sanitizeUrl(event.data.target.href) } } } as RecordedEvent;
      }
      return event;
    case 'rrweb':
    case 'annotation':
    case 'identify':
      return event;
  }
}

export function sanitizeMeta(meta: SessionMeta): SessionMeta {
  return {
    ...meta,
    page: {
      ...meta.page,
      url: sanitizeUrl(meta.page.url),
      ...(meta.page.referrer !== undefined ? { referrer: sanitizeUrl(meta.page.referrer) } : {}),
    },
  };
}

export function sanitizeBatch(batch: IngestBatch): IngestBatch {
  return {
    ...batch,
    ...(batch.meta ? { meta: sanitizeMeta(batch.meta) } : {}),
    events: batch.events.map(sanitizeEvent),
  };
}

/** Route template for a (sanitised) URL: pathname with ids replaced, no query string. */
export function routeForUrl(url: string): string {
  return routeFromPath(sanitizePath(url));
}
