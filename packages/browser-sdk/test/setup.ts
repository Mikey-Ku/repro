/**
 * happy-dom gaps that rrweb and our tests need. Each shim is only installed when missing so a
 * future happy-dom release that adds the real thing wins automatically.
 */
if (typeof (globalThis as { DOMTokenList?: unknown }).DOMTokenList === 'undefined') {
  // rrweb's polyfill step reads DOMTokenList.prototype.forEach at record() time.
  class DOMTokenListShim {
    forEach(this: Iterable<string>, cb: (value: string) => void): void {
      for (const value of this) cb(value);
    }
  }
  (globalThis as { DOMTokenList?: unknown }).DOMTokenList = DOMTokenListShim;
}

if (typeof (globalThis as { PromiseRejectionEvent?: unknown }).PromiseRejectionEvent === 'undefined') {
  class PromiseRejectionEventShim extends Event {
    readonly reason: unknown;
    readonly promise: Promise<unknown>;
    constructor(type: string, init: { reason?: unknown; promise?: Promise<unknown> } = {}) {
      super(type, { bubbles: false, cancelable: true });
      this.reason = init.reason;
      this.promise = init.promise ?? Promise.resolve();
    }
  }
  (globalThis as { PromiseRejectionEvent?: unknown }).PromiseRejectionEvent = PromiseRejectionEventShim;
}
