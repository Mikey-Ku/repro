# Examples gallery

The demo server (`apps/demo`, http://localhost:4100) hosts the Northwind checkout used by the main walkthrough plus a gallery of four smaller applications at http://localhost:4100/examples. Each one is built around a foundational UI element and breaks in a different way, so together they show what a recording, an evidence summary and a generated test look like across bug classes. All five share the global `broken | fixed` switch (`POST /__demo/mode`), so the reproduction runner works on every one of them unchanged.

| Example | Path | Element | Bug class | Success test id |
| --- | --- | --- | --- | --- |
| Account settings | `/examples/settings` | Form with text, textarea, radio, checkbox, select and password controls | Failed request with no uncaught error | `settings-saved` |
| Inbox | `/examples/inbox` | Client-side routing with a modal dialog | TypeError in a DOM handler, modal stuck | `message-sent` |
| Orders | `/examples/orders` | Sortable, filterable, paginated table | Exception on user interaction with real data | `orders-table` |
| Sign-up wizard | `/examples/signup` | Three-step wizard with a one-time code | Purely visual failure: no error, no failed request | `welcome` |

`GET /__demo/examples` returns this table as JSON; the E2E suite checks that the two agree.

## What each one teaches

**Account settings.** The save request is sent with `content-type: text/plain` while the body is JSON, so the API answers 415. The client only logs `console.error('Save failed', 415)` and leaves the form untouched. There is no exception, so the evidence summary has no earliest error; the incident comes from the console entry and the failed request shows in the network section with its status. The fix declares the body as JSON and shows a failed save in the form.

**Inbox.** Three folders are client-side routes (`history.pushState`), so one recording spans several URLs without a page load. Sending a message succeeds on the server, then the handler calls `document.getElementById('compose-dialg').close()` with a misspelled id, the TypeError leaves the dialog open, and the sent message never renders. The generated test presses Enter in the Subject field, waits for the successful POST, and expects the sent message. The fix is the correct id.

**Orders.** Two of the seeded orders are "pending pricing" with a null total. Sorting by Total does `a.total.toFixed(2)` and throws, so the spinner replaces the table and never leaves. The recording shows an Enter-key search, a column header click, and the exception with the stack. The fix compares totals as numbers and keeps unpriced orders at the end.

**Sign-up wizard.** The hardest case for any tool. On step 3 the Finish button only enables when the code is "complete", and the check compares the length to 7 while the input caps at 6. Nothing is thrown, no request fails, the only trace is a `console.warn('code incomplete')` per keystroke. The evidence summary says so in plain words ("No uncaught error was recorded; the failure may be visual only") and the generated test still fails in broken mode because the `welcome` element never appears. The fix compares to 6.

## Driving an example through Repro

1. Make sure the demo is in broken mode: `curl -X POST -H 'content-type: application/json' -d '{"mode":"broken"}' http://localhost:4100/__demo/mode`.
2. Open the example and go through its workflow until it breaks.
3. In the dashboard, open the session, read the timeline and the evidence.
4. In the Test tab add a `visible` expectation with the success test id from the table above, or record the same workflow in fixed mode and use "Suggest from a passing session", then generate.
5. In the Runs tab run against the bundled demo in broken mode (fails), then in fixed mode (passes).

`pnpm test:e2e` runs exactly that loop for all four examples in `tests/e2e/specs/examples.spec.ts`, including the check that the settings password never leaves the browser.
