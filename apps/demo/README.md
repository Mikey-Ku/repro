# @repro/demo: Northwind Supply

A small, deliberately broken checkout for a fictional stationery shop. Repro records a shopper signing in and
placing an order, watches the checkout fail, and reproduces the failure as a Playwright test. The app is also the
privacy test bed: it plants a set of canary secrets in every place a session recorder could accidentally pick them up.

- Login at `/login`, checkout at `/checkout`, confirmation at `/orders/:id` (fixed mode only).
- Server: Fastify 5 (`src/server.ts`), server-rendered HTML from `src/pages/*.ts` with a shared layout in `src/layout.ts`.
- Client: `client/app.ts`, bundled by esbuild to `public/app.js` (not minified, so the bug is readable in stack traces).
- The Repro SDK is served from `/vendor/repro.iife.js`. If `@repro/browser-sdk` has not been built yet the server logs
  a warning and serves a no-op stub, so the shop still works without recording.

## The bug and the fix

Release 1.4 of the API moved the order id from a flat `orderId` to a nested `order.id`. The checkout bundle was
never updated. Both branches live in `showConfirmation()` in `client/app.ts`:

```ts
// BUG (broken mode): the API now returns { order: { id } } but this still reads the old flat `orderId`
const orderId = data.orderId.toUpperCase();

// FIX: read the nested order object the API actually returns.
const orderId = payload.order.id;
```

In broken mode `data.orderId` is `undefined`, so `.toUpperCase()` throws
`TypeError: Cannot read properties of undefined (reading 'toUpperCase')`. The surrounding `try/catch` logs
`console.error('Order confirmation failed', error)` and rethrows, so the error surfaces as an uncaught rejection.
The "Place order" button stays disabled on "Placing order…" and no confirmation ever renders. The API itself is
correct in both modes; only the frontend changes.

In fixed mode the client renders `<section data-testid="order-confirmation" role="status">` with the order id and
total and pushes `/orders/<id>` onto history. `GET /orders/:id` renders the same confirmation server-side so a reload
works.

## Mode switching

Mode is process state (it resets on restart, defaulting to `DEMO_MODE`).

| Endpoint | Description |
| --- | --- |
| `GET /__demo/mode` | `{ mode: 'broken' \| 'fixed' }` |
| `POST /__demo/mode` with `{ "mode": "fixed" }` | switches mode, validated with zod, 400 on anything else |
| `GET /__demo/health` | `{ ok: true, mode }` |

```sh
curl -X POST -H 'content-type: application/json' -d '{"mode":"fixed"}' http://localhost:4100/__demo/mode
```

## API

Every `/api/*` route adds 80 to 150 ms of artificial latency so the recorded network timeline looks real.

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/login` `{ email, password }` | none | password must be at least 8 characters; sets the `demo_session` cookie and returns the bearer token |
| `GET /api/cart` | bearer | two line items, subtotal (cents), shipping options |
| `POST /api/orders` | bearer | presence validation only (card number at least 12 chars, CVC at least 3); returns `{ ok, order: { id, total, totalFormatted, currency, eta }, meta: { apiKey } }` |

Promo code `WELCOME10` takes 10% off the subtotal.

## Canaries

`canaries.json` holds twelve secrets. Privacy tests elsewhere in the repo read this file and assert that none of
the values ever reach the ingest API.

| Key | Value | Where it is planted |
| --- | --- | --- |
| `password` | `CANARY_PASSWORD_hunter2_9f3a1c` | typed into the password field by the E2E test |
| `cardNumber` | `CANARY_CARD_4242424242424242` | typed into the card number field |
| `cvc` | `CANARY_CVC_9317` | typed into the CVC field |
| `expiry` | `CANARY_EXPIRY_12_29` | typed into the expiry field |
| `token` | `CANARY_TOKEN_sk_live_51Hq7wR2eZvKYlo2C` | returned by `/api/login`, stored in `localStorage.demo_token` |
| `cookie` | `CANARY_COOKIE_sess_7f3a9c2e1b` | `demo_session` cookie set by `/api/login` (not HttpOnly, on purpose) |
| `bearerHeader` | `Bearer CANARY_TOKEN_...` | `Authorization` header on `/api/cart` and `/api/orders` |
| `queryToken` | `CANARY_QS_TOKEN_e2b1f0c9a7` | `?token=` on the post-login redirect to `/checkout` |
| `apiKey` | `CANARY_APIKEY_ak_test_00112233` | hidden `apiKey` input in the checkout form |
| `maskedText` | `CANARY_MASKED_TEXT_acct_998877` | `data-repro-mask` span in the order summary |
| `blockedText` | `CANARY_BLOCKED_WIDGET_5551234` | `data-repro-block` support chat widget |
| `responseSecret` | `CANARY_RESPONSE_SECRET_rk_live_zz99` | `meta.apiKey` in the `/api/orders` response body |

`src/canaries.ts` exports a typed loader for the server and tests; `client/app.ts` imports the JSON directly.

## Running it alone

```sh
pnpm --filter @repro/browser-sdk build   # optional, otherwise the stub SDK is served
pnpm --filter @repro/demo dev            # builds the client bundle, then tsx watch on http://localhost:4100
```

Environment (read from the repo root `.env` when present, never overriding variables already set):

| Variable | Default |
| --- | --- |
| `DEMO_PORT` | `4100` |
| `DEMO_MODE` | `broken` |
| `DEMO_PROJECT_KEY` | the key `pnpm db:seed` creates for the local demo project |
| `INGEST_URL` | `http://localhost:4000` |
| `DEMO_RELEASE` | `demo@1.4.2` |

Other scripts: `build` (tsup server plus esbuild client), `start` (`node dist/server.js`), `typecheck`, `lint`, `test`.

## Examples gallery

`/examples` lists four more small applications that share this server, its layout and its broken/fixed switch. Each is one foundational UI element with one bug class; `docs/EXAMPLES.md` has the full table and what each teaches.

| Example | The bug (broken mode) | The fix |
| --- | --- | --- |
| `/examples/settings` | `fetch` sends JSON with `content-type: text/plain`; the API answers 415 and the client only logs it | declare the body as JSON and show the failure in the form |
| `/examples/inbox` | `document.getElementById('compose-dialg').close()` with a misspelled id throws and the dialog stays open | the real id `compose-dialog` |
| `/examples/orders` | sorting by Total calls `a.total.toFixed(2)` on a null total and throws | compare totals as numbers, unpriced orders last |
| `/examples/signup` | the Finish button enables only when `value.length === 7` while the input caps at 6 | `value.length === 6` |

Server modules live in `src/examples/`, pages in `src/pages/examples/`, clients in `client/examples/` (one bundle each, built by `scripts/build-client.mjs`). `GET /__demo/examples` returns the gallery metadata.
