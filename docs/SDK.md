# SDK integration guide

The SDK is `@repro/browser-sdk`. Full option reference: `packages/browser-sdk/README.md`. This page covers how to wire it into common setups.

## Script tag

```html
<script src="/vendor/repro.iife.js"></script>
<script>
  Repro.init({
    projectKey: 'rp_...',            // from the dashboard, Settings > Ingestion keys
    endpoint: 'http://localhost:4000',
    release: 'web@1.4.2',
    environment: 'production',
  });
</script>
```

Serve `node_modules/@repro/browser-sdk/dist/repro.iife.js` from your own origin. Loading it before your application script means the first snapshot includes the initial render.

## ES modules

```ts
import { Repro } from '@repro/browser-sdk';

const repro = Repro.init({ projectKey: import.meta.env.VITE_REPRO_KEY, endpoint: 'https://repro.internal' });

// Later, in an error boundary or a catch block:
repro.captureException(error, { component: 'CheckoutForm' });

// Mark a step so it shows up in the timeline:
repro.annotate('checkout:submitted', { items: 2 });

// Identify with an opaque id only. Email-shaped ids are refused.
repro.identify('usr_1042', { plan: 'pro' });
```

## React

Initialise once, at module scope in your entry file, not inside a component. Wrap `captureException` in your error boundary's `componentDidCatch`. React re-renders are ordinary DOM mutations to rrweb, so nothing else is needed.

## Next.js

Create a client component that calls `Repro.init` in a `useEffect` with an empty dependency array, and render it once in the root layout. Pass the key through `NEXT_PUBLIC_REPRO_KEY`; ingestion keys are write-only, so exposing one to the browser is expected.

## Marking sensitive content

| Attribute | Effect |
| --- | --- |
| `data-repro-mask` | Text inside is replaced by asterisks; input values are masked |
| `data-repro-block` | The subtree is replaced by a same-size placeholder |
| `data-repro-ignore` | Input events for the subtree are not recorded |
| `data-testid` | Preferred selector for generated tests |

The rrweb classes `rr-mask`, `rr-block` and `rr-ignore` are honoured too.

Password, hidden, and payment fields are masked with no markup. Fields whose name, id, label, placeholder or autocomplete mention secrets, tokens, auth, cookies, sessions, api keys, social security numbers or pins are masked. Set `strict: true` to mask every free-text input.

## Session lifecycle

- A session starts on `init` (unless `autoStart: false`) and continues across full page loads in the same tab.
- `stop()` sends the final batch and marks the session complete. If the tab is closed without `stop()`, the worker marks the session expired after 30 minutes of silence and processes what arrived. In on-incident mode (below), `stop()` before any incident discards the buffer instead.
- `flush()` returns a promise you can await before navigating away in code.

## Record on incident

By default every session is uploaded. Set `mode: 'on-incident'` to record into a rolling in-memory buffer and upload only when something goes wrong, which makes the SDK nearly free for the healthy majority of sessions.

```ts
Repro.init({
  projectKey: import.meta.env.VITE_REPRO_KEY,
  endpoint: 'https://repro.internal',
  mode: 'on-incident',
  bufferSeconds: 30, // history kept before an incident, default 30
  bufferEvents: 2000, // memory bound, default 2000
});

// Your own definition of an incident, recorded as an `incident:<reason>` annotation:
repro.flagIncident('payment-timeout', { attempt: 2 });
```

What counts as an incident: an uncaught exception, an unhandled promise rejection, `captureException()`, a request that failed with a 5xx status or no response at all (4xx answers and aborted requests do not count), or `flagIncident()`. On the first one the buffered events are uploaded as the session's first batches, the session row is created on the server at that moment, and the SDK behaves like `mode: 'always'` for the rest of the session, across page loads too (the triggered state lives in `sessionStorage` next to the session id).

The buffer is cut only at rrweb checkouts, which happen every `bufferSeconds / 2` in this mode, so the replay always starts with a full snapshot. The retained history is between `bufferSeconds` and 1.5 x `bufferSeconds`: with the defaults, a replay shows the 30 to 45 seconds before the incident and nothing earlier. That is the trade-off. In return a healthy session costs only memory: no requests, no server row, and `stop()` before any incident discards the buffer and clears the persisted session. `isRecording()` stays true while buffering; `getMode()` and `hasTriggered()` tell you which state the client is in. Full details and the option reference are in `packages/browser-sdk/README.md`.

## Content Security Policy

Allow `connect-src` to your ingest origin. The SDK does not inline styles or scripts.

## What is sent

See `docs/EVENT_SCHEMA.md`. Batches are gzip JSON posted to `POST /v1/ingest` with the `x-repro-key` header. Nothing is sent to any third party.
