# Test generation

How a recorded session becomes a Playwright test. The code lives in `packages/test-generator`; the normalisation step it depends on lives in `packages/contracts/src/normalize.ts`.

The generator has one job: given the same recording, produce the same test, every time, with nothing in it that the recording did not justify. It does not guess, it does not call a model, and it explains every event it leaves out.

## Pipeline

```
RecordedEvent[]  --normalizeEvents-->  NormalizedAction[] + omitted + trailingRequests
                 --chooseSelector--->  one locator per interaction, or a skip with a reason
                 --emitTest--------->  unformatted TypeScript with header, steps, waits, expectations
                 --prettier--------->  GeneratorOutput.code
```

`sourceHash` is computed from the normalised actions before emission, so it identifies the test independently of formatting.

## Normalisation rules

`normalizeEvents` in `@repro/contracts` turns the raw event stream into a compact list of actions. Each rule is deterministic and applied in seq order, whatever order the events arrived in.

1. The first navigation becomes `navigate`; later navigations become `expect-url`. A later navigation to the path the test is already on is omitted as a duplicate or a reload.
2. Consecutive inputs on the same control collapse to the last value. Earlier values are omitted as "superseded by a later value on the same control".
3. A click on a form control that is then filled is dropped, because filling implies focus.
4. A click on a submit control followed by a submit event keeps the click and drops the submit, because the click is what triggers the submission.
5. A submit with no preceding submit click becomes `press-enter` on the last filled or selected control. A submit with no filled control at all stays a `submit` action, emitted with `requestSubmit()` and a warning.
6. Clicks on `<label>` and `<option>` elements are omitted, because the input that follows implies them.
7. rrweb, console, network, error, annotation and identify events are never actions. The first uncaught error is kept as `firstError` for the header comment, and network events that complete after the last action (and before the first error, with a small allowance) become `trailingRequests`.

"Same control" means the same `testId`, else the same `id`, else the same `name` and `formId` on the same tag, else the same `cssPath`.

The resulting action kinds are `navigate`, `expect-url`, `click`, `fill`, `select`, `check`, `press-enter` and `submit`. Masked fills carry `value: null` and `masked: true`; the recorded value is never present.

## Selector priority

`chooseSelector` tries strategies in order and the first match wins. The chosen strategy is reported for every interaction in `GeneratorOutput.selectors`, so the dashboard can show why a test is or is not robust.

| Priority | Strategy | Emitted locator | When |
| --- | --- | --- | --- |
| 1 | `testid` | `page.getByTestId('promo-code')` | `data-testid` was recorded. Test ids exist for exactly this purpose. |
| 2 | `role` | `page.getByRole('button', { name: 'Place order', exact: true })` | A role and an accessible name (or `aria-label`) were recorded. Native controls get their implicit role (`<button>` is `button`, `<select>` is `combobox`, `<input type=checkbox>` is `checkbox`, `<a href>` is `link`, and so on). Roles outside the list `getByRole` accepts are ignored. |
| 3 | `label` | `page.getByLabel('Card number')` | The control has a visible label. |
| 4 | `placeholder` | `page.getByPlaceholder('City')` | The control has placeholder text. |
| 5 | `attribute` | `page.locator('#postal-code')` or `page.locator('form#checkout-form input[name="postalCode"]')` | An author-written `id`, else a `name` attribute scoped to its form (`form#id` or `[data-testid=...]`). Ids that look generated at render time (React `useId` values such as `:r1:`, Radix, Headless UI, MUI prefixes, or a trailing run of four or more digits) are skipped because they change between page loads. The form-scoped form carries a note. |
| 6 | `css` | `page.locator('main > div.hero > div:nth-child(2)')` | Only the recorded CSS path is available. The entry carries a note saying the selector may be brittle, and a warning is added to the output. |
| 7 | `none` | (nothing) | Nothing usable was recorded. The step is omitted with a reason, listed in `omitted` and in `warnings`, and a `// Skipped ...` comment marks its place in the test. |

Descriptors never contain rrweb node ids, and no strategy derives one.

## What each action emits

| Action | Code |
| --- | --- |
| `navigate` | `await page.goto('/path');` with the recorded origin in a comment, followed by `await expect(<first locator used on that page>).toBeVisible();` so the test waits for the page before interacting. |
| `expect-url` | `await expect(page).toHaveURL(/\/path/);` (the path without its query string, regex-escaped). |
| `click` | `await <locator>.click();` |
| `fill` | `await <locator>.fill('value');`, or `.fill(fixture('name'))` when the value was masked (see Secrets). |
| `select` | `await <locator>.selectOption('value');`. A select whose value was not recorded is omitted with a reason. |
| `fill` on `<input type=file>`, `range` or `color` | Omitted with a reason; see Unsupported interactions. |
| `check` | `await <locator>.check();` or `.uncheck();` |
| `press-enter` | `await <locator>.press('Enter');` |
| `submit` | `await <locator>.evaluate((form) => (form as HTMLFormElement).requestSubmit());` with a comment and a warning, because no button was recorded. |

Every step is preceded by `// Step N (mm:ss.mmm): <description>` where the offset is measured from the session start. Omitted steps keep a `// Skipped <description> (seq N): <reason>` comment so the reader can see where the recording had more than the test does.

### Waiting for the network

If the recording shows a request completing after the last action (`trailingRequests`), the generator wraps the last emitted interaction in a `page.waitForResponse` that matches the exact pathname and upper-cased method, then asserts `response.ok()`. Requests answered before the last action are not waited for; the test relies on locators and assertions to synchronise the rest.

### Success state and the error guard

Every test registers `page.on('pageerror', ...)` before the first step and ends with:

```ts
await page.waitForLoadState('networkidle');
expect(pageErrors, 'the workflow should complete without uncaught errors').toEqual([]);
```

This is the `no-errors` expectation and it is always applied. The caller can add up to five more `Expectation`s describing what a fixed build should show:

- `{ kind: 'visible', testId }`, `{ kind: 'visible', role, name? }` or `{ kind: 'visible', text }` becomes `await expect(<locator>).toBeVisible();`
- `{ kind: 'url', pathPrefix }` becomes `await expect(page).toHaveURL(new RegExp('^<escaped prefix>'));`

Expectations are emitted in the order given, after the last step. Duplicates are dropped and an expectation with an unknown kind or no usable field is ignored with a warning rather than failing generation. When the recording captured an uncaught error, it is quoted in a comment just above the guard.

### Where the success state comes from

A recording of a failure shows what went wrong; it cannot show what "fixed" looks like, because that state never happened. The generator therefore never invents expectations. They come from three sources:

1. **The engineer.** The Test tab's expectation builder: a test id, a role and name, a text, or a URL prefix, typed by someone who knows what the fixed page should show. Up to five per test.
2. **A reference session.** A completed session on the same route with no uncaught errors and no failed requests is a recording of the success state. The dashboard's "Suggest from a passing session" block (backed by `GET .../reference-candidates` and `GET .../expectation-suggestions?reference=`, see `docs/API.md`) extracts DOM markers from both sessions with `extractDomMarkers` in `@repro/contracts` and proposes whatever appeared only in the passing one: a `visible` expectation per `data-testid`, per `role="status"` or `aria-live` text and per h1..h3 text, and a `url` expectation when the passing session ended on a different path. Each suggestion carries a reason; the engineer adds the ones that describe the fix and leaves the rest.
3. **The default guard.** `no-errors` is always applied, so even a test with no other expectation fails on the broken build if the bug throws. It is the whole heuristic list: without a reference the suggestions endpoint returns nothing else.

Limits of the comparison. Only four things are compared: test ids, live-region texts, h1..h3 texts and the final path. Anything else that differs between the sessions (button labels, table rows, class names, styles) is not looked at, so a fix that only changes those produces no suggestion and the expectation has to be typed. The comparison is also only as stable as the markers: test ids that embed a record id (`row-8f3a...`) or texts that include a timestamp, an order number or a user's name differ between every session and show up as noise, and a suggestion built from one will fail on the next run. Prefer stable ids and static status copy in the application, and read the reason before adding a suggestion. Markers come from rrweb snapshots and mutations, so a page that renders inside a cross-origin iframe or a shadow root contributes nothing (see `docs/LIMITATIONS.md`).

## Secrets and fixtures

The browser SDK masks sensitive controls (passwords, payment fields, anything whose name, id, label, placeholder or `autocomplete` hints at a secret; see `docs/PRIVACY.md`) before serialising, so the event stream carries `value: null, masked: true` and nothing else. The generator therefore cannot leak a secret, but it still has to produce a test that types something.

A masked fill becomes:

```ts
await page.getByLabel('Card number').fill(fixture('cardNumber')); // value redacted at capture; provide REPRO_FIXTURE_CARD_NUMBER
```

backed by a helper emitted once at the top of the file:

```ts
const fixture = (name: string) =>
  process.env[`REPRO_FIXTURE_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`] ??
  `REDACTED_${name}`;
```

The fixture name is derived from the control's `name`, `id`, `label`, `aria-label`, `placeholder` or accessible name, in that order, converted to camelCase. `card_number`, `Card number` and `cc-number` all become `cardNumber`, whose variable is `REPRO_FIXTURE_CARD_NUMBER`. A control with no readable hint becomes `field<seq>`.

Whoever runs the test supplies the values through the environment. When a variable is missing the test types `REDACTED_cardNumber`, which keeps it runnable and makes the missing fixture obvious in the failure. The reproduction runner only allows `process.env` reads of the `REPRO_FIXTURE_*` form, so this helper is the single sanctioned way a generated test reaches outside itself.

## Unsupported interactions

The SDK records clicks, inputs, submits and navigations with element descriptors. Anything it does not record cannot be generated. Today that means:

| Interaction | What happens |
| --- | --- |
| Drag and drop | Not recorded. The drop target's state change, if any, may show up as a later click or input. |
| File upload | The file chooser is outside the page. The SDK records the change on `<input type=file>` as a masked input of kind `other` with no value, and the generator omits it with the reason `Changes to <input type="file"> cannot be replayed from a recording.` The same applies to `range` and `color` inputs. |
| Keyboard shortcuts and key presses other than Enter | Not recorded. Only a form submission with no button click is turned into `press('Enter')`. |
| Hover-only interactions (menus that open on mouseover) | Not recorded. The click on the revealed item is, and Playwright's actionability checks will usually make it work; if the item is hidden until hover the test fails at that step. |
| Iframes | Cross-origin iframes are not recorded at all (see `docs/LIMITATIONS.md`). Interaction listeners are attached to the top document, so clicks and inputs inside any iframe do not become events. |
| Shadow DOM | Interactions inside a shadow root produce a descriptor for the host element only, so the CSS path and role may point at the host rather than the inner control and the generated selector may miss. Add a `data-testid` on the host. |
| Multiple tabs and windows | Each tab has its own session. The generator produces one test per session and cannot express `context.waitForEvent('page')`. |
| Scrolling, resizing, focus changes | Recorded by rrweb for replay, never as actions. |
| Clipboard, geolocation, permissions, dialogs | Not recorded. `alert`/`confirm` dialogs are auto-dismissed by Playwright. |

### How omissions are reported

Nothing is dropped silently. Every recorded event that does not become a step appears in `GeneratorOutput.omitted` as `{ seq, type, reason }`, whether it was collapsed by normalisation ("Superseded by a later value on the same control.") or skipped by the generator ("No stable selector was available for <span> ..."). The header comment states the total (`// Omitted events: 3`), generator-side skips also leave a `// Skipped ...` comment in place, and `warnings` carries a human-readable line for each brittle selector, skipped step, `requestSubmit` fallback and ignored expectation. The dashboard shows the list next to the code.

## Determinism guarantee

Given the same `GeneratorInput`, `generatePlaywrightTest` returns byte-identical `code` and the same `sourceHash`. Specifically:

- Events are sorted by `seq` before anything reads them, so arrival order does not matter.
- No step of the pipeline reads a clock, generates an id or iterates an unordered collection. The only time values in the output are the recorded start (as an ISO string in the header) and the recorded offsets in step comments.
- Formatting is fixed: prettier with `parser: 'typescript'`, `singleQuote: true`, `semi: true`, `printWidth: 100`. Running prettier over the output again changes nothing.

### What the source hash covers

`sourceHash` is `sha256(canonicalJson({ generatorVersion, actions, expectations, testName, initialUrl }))`, where:

- `actions` are the normalised actions with their `ts` removed. Two recordings of the same clicks at different speeds are the same test.
- `expectations` are the applied expectations, after `no-errors` is prepended and duplicates are dropped.
- `testName` is the final name, after trimming, sanitising and the derived fallback.
- `initialUrl` is `session.initialUrl`, so the same actions on a different starting page hash differently.
- `canonicalJson` sorts object keys at every level and drops `undefined`, so property assignment order is irrelevant.

Session id, project, release, browser, incident and dashboard URL are header-only and not hashed: relabelling a session does not make its test stale. `GENERATOR_VERSION` is hashed, so a generator upgrade changes every hash and stored tests can be regenerated.

## Safety of the generated code

Recorded text is typed by strangers. Every string that lands in the file passes through one of three helpers in `packages/test-generator/src/literal.ts`:

- `stringLiteral` produces a single-quoted literal with backslashes, quotes, `\n`, `\r`, `\t`, U+2028, U+2029 and all other control characters escaped. Backticks and `${` are inert inside single quotes and pass through.
- `regexEscape` escapes every regex metacharacter, including `/`, and hex-escapes non-ASCII, so a path can sit inside a regex literal or `new RegExp`.
- `commentText` replaces control characters and line terminators with spaces and collapses whitespace, so a comment can never be ended early.

`test/fixtures/injection.json` is a session where every string is a breakout attempt (`'); require('child_process') //`, `${process.env.HOME}`, `*/ process.exit(1) /*`, raw U+2028, and so on). The tests assert that prettier and the TypeScript parser both accept the output, that each payload survives verbatim as a literal, and that `require`, `child_process`, `execSync`, `exit` and `HOME` never appear as identifiers in the code. The reproduction runner adds its own allowlist check before executing anything (see `docs/REPRODUCTION_RUNNER.md`).
