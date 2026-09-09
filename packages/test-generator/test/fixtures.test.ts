import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { normalizeEvents } from '@repro/contracts';
import { GENERATOR_VERSION, generatePlaywrightTest } from '../src/index.js';
import { identifiersOf, lineIndex, linesOf, literalsOf, loadFixture, parseErrorsOf } from './helpers.js';

const PRETTIER_OPTIONS = { parser: 'typescript', singleQuote: true, semi: true, printWidth: 100 } as const;

describe('checkout-broken fixture', () => {
  const input = loadFixture('checkout-broken');

  it('seeds canary values into the masked fields of the fixture, so a leak would be visible', () => {
    // The SDK never sends a value for a masked control, but the generator must not rely on that.
    const maskedValues = input.events
      .filter((e) => e.type === 'input' && e.data.masked)
      .map((e) => (e.type === 'input' ? e.data.value : null));
    expect(maskedValues.length).toBeGreaterThanOrEqual(4);
    for (const value of maskedValues) expect(value).toMatch(/^CANARY_/);
    // Normalisation is the layer that drops them.
    const fills = normalizeEvents(input.events).actions.filter((a) => a.kind === 'fill' && a.masked);
    for (const fill of fills) expect(fill).toMatchObject({ value: null, masked: true });
  });

  it('never emits a masked value anywhere in the output', async () => {
    const output = await generatePlaywrightTest(input);
    expect(output.code).not.toContain('CANARY_');
    expect(JSON.stringify(output)).not.toContain('CANARY_');
  });

  it('fills redacted fields from fixtures and explains which env var provides each one', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain("page.getByLabel('Card number').fill(fixture('cardNumber'))");
    expect(code).toContain('provide REPRO_FIXTURE_CARD_NUMBER');
    expect(code).toContain("fill(fixture('password'))");
    expect(code).toContain("fill(fixture('cardExpiry'))");
    expect(code).toContain("fill(fixture('cardCvc'))");
    // The helper is emitted exactly once, before the test body.
    expect(code.match(/const fixture = \(name: string\) =>/g)).toHaveLength(1);
    expect(code).toContain('process.env[`REPRO_FIXTURE_${name');
    expect(code).toContain('`REDACTED_${name}`');
    expect(code.indexOf('const fixture')).toBeLessThan(code.indexOf('test('));
  });

  it('translates each kind of action into the matching Playwright call', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain("await page.goto('/login');");
    expect(code).toContain('// Recorded origin: https://shop.example.com');
    expect(code).toContain("page.getByRole('textbox', { name: 'Email', exact: true }).fill('dev@repro.local')");
    expect(code).toContain("page.getByRole('button', { name: 'Sign in', exact: true }).click()");
    expect(code).toContain('await expect(page).toHaveURL(/\\/checkout/);');
    expect(code).toContain("getByRole('combobox', { name: 'Shipping method', exact: true })");
    expect(code).toContain(".selectOption('express')");
    expect(code).toContain("page.getByRole('checkbox', { name: 'Save card for next time', exact: true }).check()");
    expect(code).toContain("page.getByRole('button', { name: 'Place order', exact: true }).click()");
    expect(code).toContain("page.getByTestId('promo-code').fill('SAVE10')");
    expect(code).toContain("page.getByPlaceholder('City').fill('London')");
    expect(code).toContain("page.locator('form#checkout-form input[name=\"postalCode\"]').fill('N1 9GU')");
  });

  it('waits for the page after navigating by expecting the first selector used on it', async () => {
    const lines = linesOf((await generatePlaywrightTest(input)).code);
    const goto = lineIndex(lines, "await page.goto('/login');");
    expect(lines[goto + 1]).toBe("await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();");
  });

  it('guards against uncaught page errors and checks them last', async () => {
    const lines = linesOf((await generatePlaywrightTest(input)).code);
    expect(lines).toContain('const pageErrors: string[] = [];');
    expect(lines).toContain("page.on('pageerror', (error) => pageErrors.push(String(error)));");
    expect(lines.at(-1)).toBe('});');
    expect(lines.at(-2)).toBe("expect(pageErrors, 'the workflow should complete without uncaught errors').toEqual([]);");
    expect(lines.at(-3)).toBe("await page.waitForLoadState('networkidle');");
  });

  it('waits for the trailing request around the last action, by exact pathname and method', async () => {
    const { code } = await generatePlaywrightTest(input);
    const lines = linesOf(code);
    const promise = lineIndex(lines, 'const responsePromise = page.waitForResponse(');
    const click = lineIndex(lines, "name: 'Place order', exact: true }).click()");
    const awaited = lineIndex(lines, 'const response = await responsePromise;');
    const check = lineIndex(lines, "expect(response.ok(), 'POST /api/orders should succeed').toBeTruthy();");
    expect(promise).toBeGreaterThan(0);
    expect(promise).toBeLessThan(click);
    expect(click).toBeLessThan(awaited);
    expect(awaited).toBeLessThan(check);
    expect(code).toContain("new URL(response.url()).pathname === '/api/orders'");
    expect(code).toContain("response.request().method() === 'POST'");
    // The earlier login request is not waited for: only the request after the last action is.
    expect(code).not.toContain("'/api/login'");
  });

  it('adds the visible expectation only when it is requested', async () => {
    const withExpectation = await generatePlaywrightTest(input);
    expect(withExpectation.code).toContain("await expect(page.getByTestId('order-confirmation')).toBeVisible();");
    const without = await generatePlaywrightTest({ ...input, expectations: [] });
    expect(without.code).not.toContain('order-confirmation');
    expect(without.sourceHash).not.toBe(withExpectation.sourceHash);
  });

  it('writes a header with the session metadata and the omitted count', async () => {
    const output = await generatePlaywrightTest(input);
    const lines = linesOf(output.code);
    expect(lines[0]).toBe('// Generated by Repro. Do not edit by hand; regenerate it from the session instead.');
    expect(lines).toContain('// Session: 3f1c2a9e-5b7d-4c8e-9a0b-1d2e3f4a5b6c');
    expect(lines).toContain('// Project: demo');
    expect(lines).toContain(`// Recorded: ${new Date(input.session.startedAt).toISOString()}`);
    expect(lines).toContain('// Release: 2026.09.1');
    expect(lines).toContain('// Browser: Chrome 140');
    expect(lines).toContain('// Incident: TypeError after Place order on /checkout');
    expect(lines).toContain('// Dashboard: http://localhost:3000/p/demo/sessions/3f1c2a9e-5b7d-4c8e-9a0b-1d2e3f4a5b6c');
    expect(lines).toContain(`// Generator: @repro/test-generator ${GENERATOR_VERSION}`);
    expect(lines).toContain(`// Source hash: ${output.sourceHash}`);
    expect(lines).toContain('// Omitted events: 3 (each one is listed with its reason in the Repro dashboard)');
    expect(output.omitted).toHaveLength(3);
    expect(lines).toContain("// Recorded error: TypeError: Cannot read properties of undefined (reading 'total')");
  });

  it('numbers the steps with mm:ss.mmm offsets from the session start', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain('// Step 1 (00:00.000): navigate to /login');
    expect(code).toContain('// Step 2 (00:02.140): fill "Email"');
    expect(code).toContain('// Step 11 (00:15.600): fill "Card number"');
    expect(code).toContain('// Step 16 (00:21.900): click "Place order"');
  });

  it('reports which selector strategy each action used, in seq order', async () => {
    const { selectors, omitted, name } = await generatePlaywrightTest(input);
    expect(selectors.map((s) => [s.seq, s.strategy])).toEqual([
      [4, 'role'],
      [5, 'role'],
      [6, 'role'],
      [10, 'role'],
      [11, 'label'],
      [12, 'placeholder'],
      [13, 'attribute'],
      [14, 'role'],
      [15, 'label'],
      [16, 'label'],
      [17, 'label'],
      [18, 'testid'],
      [19, 'role'],
      [20, 'role'],
    ]);
    expect(selectors.find((s) => s.seq === 13)?.note).toMatch(/scoped to its form/i);
    expect(omitted.map((o) => [o.seq, o.type])).toEqual([
      [3, 'click'],
      [7, 'submit'],
      [21, 'submit'],
    ]);
    expect(name).toBe('/login: click "Place order" completes');
  });

  it('is already formatted: running prettier again changes nothing', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(await prettier.format(code, PRETTIER_OPTIONS)).toBe(code);
    expect(parseErrorsOf(code)).toEqual([]);
  });
});

describe('enter-submit fixture', () => {
  const input = loadFixture('enter-submit');

  it('presses Enter in the last filled control when the form was submitted without a button', async () => {
    const { code, selectors, omitted, warnings } = await generatePlaywrightTest(input);
    expect(code).toContain("page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('running shoes')");
    expect(code).toContain("page.getByRole('searchbox', { name: 'Search products', exact: true }).press('Enter')");
    expect(code).not.toContain('requestSubmit');
    expect(selectors.map((s) => s.action)).toEqual(['fill "Search products"', 'press Enter in "Search products"']);
    expect(omitted).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('turns the later navigation and the url expectation into toHaveURL checks', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain('await expect(page).toHaveURL(/\\/search/);');
    expect(code).toContain("await expect(page).toHaveURL(new RegExp('^\\\\/search'));");
  });

  it('wraps the GET that followed the Enter key', async () => {
    const lines = linesOf((await generatePlaywrightTest(input)).code);
    const promise = lineIndex(lines, 'const responsePromise = page.waitForResponse(');
    const press = lineIndex(lines, ".press('Enter');");
    expect(promise).toBeLessThan(press);
    expect(lines).toContain("new URL(response.url()).pathname === '/api/search' && response.request().method() === 'GET',");
    expect(lines).toContain("expect(response.ok(), 'GET /api/search should succeed').toBeTruthy();");
  });

  it('omits the fixture helper and optional header lines when nothing needs them', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).not.toContain('const fixture');
    expect(code).toContain('// Release: unknown');
    expect(code).not.toContain('// Dashboard:');
    expect(code).not.toContain('// Incident:');
    expect(code).toContain('// Omitted events: 0\n');
  });
});

describe('no-stable-selector fixture', () => {
  const input = loadFixture('no-stable-selector');

  it('falls back to the recorded CSS path with a brittleness note and a warning', async () => {
    const { code, selectors, warnings } = await generatePlaywrightTest(input);
    expect(code).toContain("await page.locator('main > div.hero > div:nth-child(2)').click();");
    const css = selectors.find((s) => s.seq === 1);
    expect(css).toMatchObject({ strategy: 'css', selector: "page.locator('main > div.hero > div:nth-child(2)')" });
    expect(css?.note).toMatch(/brittle/);
    expect(warnings).toContainEqual(expect.stringMatching(/click <div> \(seq 1\) uses a CSS path fallback/));
  });

  it('omits a click with no usable descriptor and says so in the code and the report', async () => {
    const { code, selectors, omitted, warnings } = await generatePlaywrightTest(input);
    expect(code).toContain('// Skipped click <span> (seq 2): No stable selector was available for <span>');
    expect(code).not.toContain("locator('span')");
    expect(selectors.find((s) => s.seq === 2)).toMatchObject({ strategy: 'none', selector: '' });
    expect(omitted).toEqual([{ seq: 2, type: 'click', reason: expect.stringMatching(/No stable selector/) }]);
    expect(warnings).toContainEqual(expect.stringMatching(/^Omitted click <span> \(seq 2\)/));
    expect(code).toContain('// Omitted events: 1');
  });

  it('keeps numbering the emitted steps without the skipped one', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain('// Step 2 (00:01.000): click <div>');
    expect(code).toContain('// Step 3 (00:03.000): click "Add to cart"');
    expect(code).not.toContain('// Step 4');
  });
});

describe('injection fixture', () => {
  const input = loadFixture('injection');

  it('produces code that prettier and the TypeScript parser both accept', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(parseErrorsOf(code)).toEqual([]);
    expect(await prettier.format(code, PRETTIER_OPTIONS)).toBe(code);
  });

  it('keeps every recorded payload inside a literal: none of it becomes code', async () => {
    const { code } = await generatePlaywrightTest(input);
    const identifiers = identifiersOf(code);
    expect(identifiers).not.toContain('require');
    expect(identifiers).not.toContain('child_process');
    expect(identifiers).not.toContain('execSync');
    expect(identifiers).not.toContain('exit');
    expect(identifiers).not.toContain('HOME');
    // The only `process` in the file is the fixture helper reading process.env.
    expect(identifiers.filter((name) => name === 'process')).toHaveLength(1);
    expect(code).toContain('process.env[`REPRO_FIXTURE_');
    // The payloads survive verbatim as data, because the test must type what the user typed.
    const literals = literalsOf(code);
    expect(literals).toContain("'); require('child_process').execSync('touch /tmp/pwned') //");
    expect(literals).toContain('tab\there "double" \'single\' \\ end');
    expect(literals).toContain('Note `${process.env.HOME}`\nsecond line');
  });

  it('never emits a raw line terminator that could end a literal or a comment', async () => {
    const { code } = await generatePlaywrightTest(input);
    const rawSeparator = input.events.find((e) => e.type === 'input' && e.data.target.placeholder?.includes('\u2028'));
    expect(rawSeparator).toBeDefined();
    expect(code).not.toMatch(/[\u2028\u2029\r]/);
    expect(code).toContain('\\u2028');
    // Comments stay on one line each: the injected newline in the release becomes a space.
    expect(code).toContain('// Release: 1.0.0 // injected release line');
    expect(code).toContain('// Incident: Title with `backticks` and ${process.env.HOME} and a newline');
    expect(code).toContain('// Recorded error: Error: boom */ process.exit(1) /* second line');
    for (const line of code.split('\n').filter((l) => l.trimStart().startsWith('//'))) {
      expect(line).not.toContain('\n');
    }
  });

  it('escapes the test name and the expectations too', async () => {
    const { code, name } = await generatePlaywrightTest(input);
    expect(name).toBe('Name with \'quotes\' and newlines and "doubles"');
    expect(code).toContain("test('Name with \\'quotes\\' and newlines and \"doubles\"', async ({ page }) => {");
    expect(literalsOf(code)).toContain("Done'); process.exit(1); ('");
    expect(code).toContain('toHaveURL(new RegExp("^\\\\/done\\\\/\'\\\\); process\\\\.exit\\\\(1\\\\); \\\\(\'"))');
  });

  it('treats a masked field with a hostile name as a fixture and quotes it in the selector', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).toContain(".fill(fixture('secretProcessExit1'))");
    expect(code).toContain('provide REPRO_FIXTURE_SECRET_PROCESS_EXIT1');
    expect(literalsOf(code)).toContain('input[name="secret\'); process.exit(1); (\'"]');
    expect(literalsOf(code)).toContain('form[id="form with spaces"] input[name="weird\\"name]"]');
  });
});
