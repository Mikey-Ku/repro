# @repro/browser-sdk

Privacy-first session recording for the browser. The SDK records what a user did (DOM replay via rrweb, clicks, form changes, navigation, network shape, errors, console errors) and uploads it in batches to a Repro ingest endpoint. It is built so that secrets are dropped or masked before anything leaves the page.

## Install

```sh
pnpm add @repro/browser-sdk
```

Two builds ship in `dist/`:

- `dist/index.js`: ESM with type declarations, for bundlers.
- `dist/repro.iife.js`: a minified script-tag build that exposes `window.Repro`.

Both inline rrweb and the shared contracts, so nothing else needs to be installed. Run `pnpm --filter @repro/browser-sdk size` after a build to print raw, gzip and brotli sizes. Measured for 0.1.0 with record-on-incident mode included:

| File | Raw | gzip | brotli |
| --- | --- | --- | --- |
| `dist/repro.iife.js` | 206.7 kB | 67.0 kB | 45.4 kB |
| `dist/index.js` | 444.7 kB | 95.3 kB | 61.1 kB |

Most of the script-tag build is rrweb's recorder. The SDK imports `@repro/contracts/runtime`, a Zod-free entry that carries only the limits and redaction helpers, so no schema code ships to the browser; the ESM build is larger because it is not minified. Record-on-incident mode adds about 2.4 kB raw (1 kB gzip) to the script-tag build.

## Usage

Script tag:

```html
<script src="/vendor/repro.iife.js"></script>
<script>
  Repro.init({
    projectKey: 'rp_...',
    endpoint: 'https://ingest.example.com',
    release: '2026.09.1',
  });
</script>
```

ESM:

```ts
import { Repro } from '@repro/browser-sdk';

const client = Repro.init({
  projectKey: 'rp_...',
  endpoint: 'https://ingest.example.com',
  environment: 'production',
});

client.identify('user_42', { plan: 'pro' });
client.annotate('checkout:step', { step: 2 });

try {
  await pay();
} catch (err) {
  client.captureException(err, { route: '/checkout' });
}
```

`Repro.init()` returns a `ReproClient`. The same methods also exist on `Repro` itself and delegate to the client created by the last `init()`, so script-tag users never need to keep a reference. Calling `init()` again stops the previous client first.

```ts
interface ReproClient {
  start(): void;
  stop(): void; // sends the final batch with final: true
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  identify(userId: string, traits?: Record<string, string | number | boolean>): void;
  annotate(name: string, data?: Record<string, string | number | boolean>): void;
  flagIncident(reason: string, data?: Record<string, string | number | boolean>): void; // annotation `incident:<reason>`, and a trigger in on-incident mode
  flush(): Promise<void>;
  getSessionId(): string | null;
  isRecording(): boolean; // true while buffering too
  getMode(): 'always' | 'on-incident';
  hasTriggered(): boolean;
}
```

Outside a browser (SSR, workers, plain Node) `init()` returns a no-op client and records nothing.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `projectKey` | required | Project ingestion key, format `rp_...`. Sent as the `x-repro-key` header. |
| `endpoint` | required | Ingest origin, for example `http://localhost:4000`. Uploads go to `${endpoint}/v1/ingest`. |
| `release` | none | Release label stored with the session. |
| `environment` | none | Environment label stored with the session. |
| `strict` | `false` | Mask every free-text input and textarea, not only the ones that look sensitive. |
| `autoStart` | `true` | Start recording inside `init()`. |
| `flushIntervalMs` | `2000` | Upload interval. Minimum 250. |
| `maxBatchEvents` | `200` | Upload as soon as this many events are buffered. |
| `maskSelector` | none | Extra CSS selector whose text and input values are masked. |
| `blockSelector` | none | Extra CSS selector whose subtree is replaced by a same-size placeholder. |
| `ignoreSelector` | none | Extra CSS selector whose inputs are not recorded at all. |
| `captureConsole` | `true` | Capture `console.error` and `console.warn` arguments. |
| `captureNetwork` | `true` | Capture fetch and XHR method, url, status and duration. |
| `sampleRate` | `1` | Fraction of sessions recorded, 0 to 1. Decided once per session. |
| `sessionId` | none | Session id override, mainly for tests. Must be a UUID. |
| `debug` | `false` | Log SDK activity with `console.debug('[repro]', ...)`. |
| `mode` | `'always'` | `'on-incident'` buffers in memory and uploads only once something goes wrong. See [Record on incident](#record-on-incident). |
| `bufferSeconds` | `30` | On-incident only. Seconds of history kept before an incident. |
| `bufferEvents` | `2000` | On-incident only. Most events kept before an incident. |

## Record on incident

The default mode uploads every session. That is right when you want a replay of everything, and wrong when you only care about sessions that broke: most sessions are healthy, and each one still costs an upload every two seconds and a row on the server. `mode: 'on-incident'` turns the SDK into a flight recorder. It records exactly as before, with the same masking, but keeps the events in a rolling in-memory buffer and uploads nothing. When an incident happens the buffer is uploaded as the first batches of the session, so the replay shows what led up to the failure, and the SDK then switches to `'always'` for the rest of the session and keeps uploading until `stop()`.

```ts
Repro.init({
  projectKey: 'rp_...',
  endpoint: 'https://ingest.example.com',
  mode: 'on-incident',
  bufferSeconds: 30, // default
  bufferEvents: 2000, // default
});

// Anything you consider an incident, for example a spinner that never resolved:
Repro.flagIncident('checkout-stuck', { step: 3 });
```

An incident is any of:

- an uncaught exception (`window.onerror`),
- an unhandled promise rejection,
- a `captureException()` call,
- a network request that failed: a response with status 500 or above, or no response at all (DNS, CORS, offline). 4xx responses and requests the page aborted itself do not count,
- a `flagIncident(reason, data?)` call, which also records an annotation named `incident:<reason>` so it shows in the timeline.

How the buffer works:

- rrweb takes a fresh checkout (a Meta event followed by a FullSnapshot) every `bufferSeconds / 2` instead of every 60 seconds. The buffer is only ever cut at a checkout, never between one and the events that depend on it, so the uploaded replay always starts with a snapshot it can render.
- On every event the SDK drops everything before the most recent checkout that is at least `bufferSeconds` old. The retained history is therefore between `bufferSeconds` and 1.5 x `bufferSeconds` long; with the defaults, the replay prefix before an incident is 30 to 45 seconds. Shorter windows cost more snapshots.
- `bufferEvents` bounds memory the same way, at checkout boundaries. If a single checkout segment outgrows it on a very busy page, the SDK asks rrweb for a fresh checkout and cuts there.
- The upload after a trigger is ordinary: `batchSeq` starts at 0 with `meta` on the first batch, events keep the sequence numbers they were given while buffering, and batches are split by the usual size limits.
- The triggered state is persisted in `sessionStorage` next to the session id, so a full page load after an incident keeps uploading the same session. A page load before an incident keeps buffering (the previous page's buffer is gone with the page).
- `stop()` before any incident discards the buffer and clears the persisted session. `flush()` before an incident resolves without sending anything.
- `isRecording()` is true while buffering. `getMode()` reports `'on-incident'` while buffering and `'always'` after the trigger; `hasTriggered()` reports whether the trigger has fired in this session.

The trade-off: a healthy session costs only memory (at most `bufferEvents` events, and no requests, no server row, nothing to delete), and the price is that the replay of a broken session starts at most 1.5 x `bufferSeconds` before the incident rather than at the beginning of the session. Interactions before that window are not recoverable. If you need the whole session for a subset of users, use `mode: 'always'` with `sampleRate`.

## Markup attributes

These work without any configuration, alongside rrweb's `rr-mask`, `rr-block` and `rr-ignore` classes.

| Attribute | Effect |
| --- | --- |
| `data-repro-mask` | Text content and input values inside the element are masked (`***` in the replay, `[redacted]` in element descriptors). |
| `data-repro-block` | The subtree is replaced by a placeholder box of the same size. Inputs inside it are masked. |
| `data-repro-ignore` | Inputs inside the element produce no input events and their values are masked in the replay. |
| `data-testid` | Captured into element descriptors and preferred by the test generator when it builds selectors. |

## What is captured

- **DOM replay** (rrweb): a full snapshot on start and every 60 seconds (every `bufferSeconds / 2` in on-incident mode), then incremental mutations, mouse movement (sampled), scroll and input changes. Canvas is not recorded.
- **Clicks**: an `ElementDescriptor` of the closest interactive ancestor (tag, `data-testid`, stable id, name, type, role, label, accessible name, placeholder, text, sanitised href, short CSS path, enclosing form), plus viewport coordinates. Never rrweb node ids, never the element's value.
- **Form changes** on `change`: the descriptor, the control kind, and the value for non-sensitive controls. Sensitive controls send `value: null, masked: true`. Checkboxes and radios send `checked`.
- **Submits**: the form descriptor.
- **Navigation**: the initial load and every `pushState`, `replaceState`, `popstate` and `hashchange`, with a sanitised URL and the document title.
- **Errors**: uncaught exceptions, unhandled promise rejections and `captureException()` calls, with name, message, stack, source location and optional context.
- **Console**: `console.error` and `console.warn` arguments, stringified with a depth limit. `console.log` is not touched.
- **Network**: for every fetch and XHR, the method, sanitised url and path, status, ok flag, duration, a random request id and a network-level error string. The SDK's own uploads are skipped.
- **Session meta**, once per page load: browser name and version, OS, user agent, viewport, sanitised page URL, title, sanitised referrer, locale, timezone and SDK version.

Sessions persist across full page loads within the same tab (sessionStorage key `repro:session`), so a multi-page flow is one session with monotonic sequence numbers. A new tab is a new session.

## What is not captured

- Request or response headers. Not even their names.
- Request or response bodies.
- Cookies, localStorage or sessionStorage contents.
- Values of password and hidden inputs, or of any control whose type, `autocomplete`, name, id, label, placeholder or `aria-label` hints at a secret (passwords, card numbers, CVC, expiry, tokens, API keys, SSN, account numbers and similar).
- Sensitive query-string and fragment parameters (`token`, `key`, `session`, `auth`, `code`, `sig` and similar). Their values become `[redacted]`; the parameter name is kept.
- Credentials embedded in URLs (`user:pass@host`).
- Email addresses passed to `identify()`. The call is ignored; use an opaque id.
- Trait, annotation and exception-context keys that look sensitive. They are dropped, not masked.
- Anything inside `data-repro-block` regions.

## Privacy guarantees

1. Redaction runs in the browser before serialisation. The ingest server re-applies the same rules as defence in depth, but the SDK never relies on it.
2. Every input value passes through one decision function, `isSensitiveField` from `@repro/contracts`, in both the rrweb replay and the interaction events. Strict mode routes through the same function. Masks keep the value's length so replays keep their layout.
3. Free text that the SDK does capture (error messages, stacks, console arguments, annotation strings, trait strings) is scrubbed for inline secrets: `Bearer` and `Basic` credentials, common API key formats, JWTs, 13 to 19 digit card numbers, and `key=value` pairs whose key looks sensitive. Console objects also have sensitive keys redacted before stringification.
4. Payload-level tests (`test/privacy.test.ts`) seed a page with a canary corpus (password, card, CVC, expiry, token, hidden API key, masked text, blocked widget, ignored input, Authorization header, request and response bodies, secret query string, bearer token in an error, secret in console output) and assert that no canary value appears in any byte the SDK would send, for both gzip and plain JSON bodies.

## Caveats

- **Plain page text is recorded.** A secret rendered as ordinary text (an API key shown in a settings page, a card number in an order summary) is captured like any other text unless it sits inside `data-repro-mask` or `data-repro-block`. Field detection only applies to form controls.
- **Path segments are not redacted.** `/users/alice/reset/abc123` is recorded as is. Only query-string and fragment parameters are sanitised. Put secrets in parameters, not paths, or block them at the router.
- **Inline scrubbing is best effort.** It recognises common secret shapes, not every possible one. The primary control is not capturing secrets in the first place.
- **Sensitivity detection is heuristic.** A field named `ref` holding a secret will be recorded. Add `data-repro-mask`, `autocomplete="off"` style hints in the name or label, or use `strict: true` when you cannot audit every form.
- **Third-party widgets** that render into the page are recorded like the rest of the DOM. Block them with `blockSelector`.

## Transport

In the default mode, batches are uploaded every `flushIntervalMs`, when `maxBatchEvents` is reached, when the tab becomes hidden, on `pagehide` (via `sendBeacon` with the key in the query string, falling back to keepalive fetch), and on `stop()` with `final: true`. Bodies are gzip compressed with `CompressionStream` when the browser has it, otherwise sent as plain JSON. Batches larger than the shared `LIMITS.maxBatchBytes` are split. Failed uploads retry with exponential backoff from 500 ms to 8 s for up to 5 attempts on network errors, 429 and 5xx; other 4xx responses drop the batch. At most 50 batches wait in memory; older ones are discarded first.

## Development

```sh
pnpm --filter @repro/browser-sdk build
pnpm --filter @repro/browser-sdk typecheck
pnpm --filter @repro/browser-sdk lint
pnpm --filter @repro/browser-sdk test
pnpm --filter @repro/browser-sdk size
```

Tests run under Vitest with happy-dom. `test/setup.ts` shims the two globals rrweb and the tests need that happy-dom lacks (`DOMTokenList.prototype.forEach` and `PromiseRejectionEvent`).
