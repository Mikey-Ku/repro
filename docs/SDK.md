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
- `stop()` sends the final batch and marks the session complete. If the tab is closed without `stop()`, the worker marks the session expired after 30 minutes of silence and processes what arrived.
- `flush()` returns a promise you can await before navigating away in code.

## Content Security Policy

Allow `connect-src` to your ingest origin. The SDK does not inline styles or scripts.

## What is sent

See `docs/EVENT_SCHEMA.md`. Batches are gzip JSON posted to `POST /v1/ingest` with the `x-repro-key` header. Nothing is sent to any third party.
