import { describe, expect, it } from 'vitest';
import {
  describeAction,
  fixtureEnvVar,
  fixtureName,
  formatOffset,
  generatePlaywrightTest,
} from '../src/index.js';
import { descriptor, ev, event, linesOf, parseErrorsOf, session } from './helpers.js';

describe('actions that the fixtures do not cover', () => {
  it('uncheck', async () => {
    const box = descriptor({ tag: 'input', type: 'checkbox', role: 'checkbox', accessibleName: 'Newsletter' });
    const { code } = await generatePlaywrightTest({
      session: session(),
      events: [ev.navigation(0, 'https://shop.example.com/'), ev.checkbox(1, box, false)],
    });
    expect(code).toContain("await page.getByRole('checkbox', { name: 'Newsletter', exact: true }).uncheck();");
    expect(code).toContain('// Step 2 (00:01.000): uncheck "Newsletter"');
  });

  it('submits a form with requestSubmit when no button and no filled control were recorded', async () => {
    const form = descriptor({ tag: 'form', id: 'contact', cssPath: 'form#contact' });
    const { code, warnings } = await generatePlaywrightTest({
      session: session(),
      events: [ev.navigation(0, 'https://shop.example.com/contact'), ev.submit(1, form)],
    });
    expect(code).toContain('// No submit button was recorded for this form, so it is submitted directly.');
    expect(code).toContain("await page.locator('#contact').evaluate((form) => (form as HTMLFormElement).requestSubmit());");
    expect(warnings).toContainEqual(expect.stringMatching(/submit form "contact" \(seq 1\) had no submit button/));
    expect(parseErrorsOf(code)).toEqual([]);
  });

  it('omits a select whose option value was not recorded', async () => {
    const select = descriptor({ tag: 'select', accessibleName: 'Size' });
    const { code, omitted, warnings, selectors } = await generatePlaywrightTest({
      session: session(),
      events: [ev.navigation(0, 'https://shop.example.com/'), ev.select(1, select, null)],
    });
    expect(code).toContain('// Skipped select an option in "Size" (seq 1): No option value was recorded for this select.');
    expect(code).not.toContain('selectOption');
    expect(omitted).toEqual([{ seq: 1, type: 'input', reason: 'No option value was recorded for this select.' }]);
    expect(warnings).toContainEqual(expect.stringMatching(/^Omitted select an option in "Size" \(seq 1\)/));
    expect(selectors).toEqual([]);
  });

  it('omits file, range and colour inputs instead of filling them with a fixture', async () => {
    const upload = descriptor({ tag: 'input', type: 'file', label: 'Attachment' });
    const slider = descriptor({ tag: 'input', type: 'range', label: 'Volume' });
    const { code, omitted, warnings } = await generatePlaywrightTest({
      session: session(),
      events: [
        ev.navigation(0, 'https://shop.example.com/'),
        // The SDK records these as kind "other", always masked, with no value.
        event(1, 'input', { target: upload, kind: 'other', value: null, masked: true }),
        event(2, 'input', { target: slider, kind: 'other', value: null, masked: true }),
        ev.click(3, descriptor({ tag: 'button', role: 'button', accessibleName: 'Send' })),
      ],
    });
    expect(code).not.toContain('fixture(');
    expect(code).not.toContain("getByLabel('Attachment')");
    expect(code).toContain('// Skipped fill "Attachment" (seq 1): Changes to <input type="file"> cannot be replayed from a recording.');
    expect(omitted.map((o) => o.seq)).toEqual([1, 2]);
    expect(warnings).toHaveLength(2);
    expect(code).toContain("name: 'Send', exact: true }).click()");
  });

  it('only checks the initial page when the session has no actions', async () => {
    const { code, warnings, name } = await generatePlaywrightTest({ session: session(), events: [] });
    expect(name).toBe('/: page loads without errors');
    expect(code).toContain("test('/: page loads without errors', async ({ page }) => {");
    expect(code).not.toContain('page.goto');
    expect(code).toContain("expect(pageErrors, 'the workflow should complete without uncaught errors').toEqual([]);");
    expect(warnings).toContain('The session contains no user actions; the test only checks the initial page for errors.');
    expect(parseErrorsOf(code)).toEqual([]);
  });

  it('places the response wait around the last emitted step, skipping omitted ones', async () => {
    const go = descriptor({ tag: 'button', role: 'button', accessibleName: 'Go' });
    const { code } = await generatePlaywrightTest({
      session: session(),
      events: [
        ev.navigation(0, 'https://shop.example.com/'),
        ev.click(1, go),
        ev.click(2, descriptor({ tag: 'span' })),
        ev.network(3, 'post', 'https://shop.example.com/api/go?verbose=1'),
        ev.error(4, 'boom'),
      ],
    });
    const lines = linesOf(code);
    const promise = lines.findIndex((l) => l.startsWith('const responsePromise'));
    const click = lines.findIndex((l) => l.includes("name: 'Go', exact: true }).click()"));
    const skipped = lines.findIndex((l) => l.startsWith('// Skipped click <span>'));
    expect(promise).toBeGreaterThan(0);
    expect(promise).toBeLessThan(click);
    expect(click).toBeLessThan(skipped);
    // Method is upper-cased and the query string is not part of the match.
    expect(code).toContain("new URL(response.url()).pathname === '/api/go' && response.request().method() === 'POST'");
    expect(code).toContain("expect(response.ok(), 'POST /api/go should succeed').toBeTruthy();");
  });

  it('does not wait for a request that was answered before the last action', async () => {
    const go = descriptor({ tag: 'button', role: 'button', accessibleName: 'Go' });
    const { code } = await generatePlaywrightTest({
      session: session(),
      events: [
        ev.navigation(0, 'https://shop.example.com/'),
        ev.network(1, 'GET', 'https://shop.example.com/api/products'),
        ev.click(2, go),
      ],
    });
    expect(code).not.toContain('waitForResponse');
  });

  it('describes a navigation with a redacted query in the step comment and strips it from the regex', async () => {
    const { code } = await generatePlaywrightTest({
      session: session(),
      events: [
        ev.navigation(0, 'https://shop.example.com/'),
        ev.click(1, descriptor({ tag: 'button', role: 'button', accessibleName: 'Go' })),
        ev.navigation(2, 'https://shop.example.com/account?token=abc&tab=orders'),
      ],
    });
    expect(code).toContain('// Step 3 (00:02.000): expect URL /account?token=%5Bredacted%5D&tab=orders');
    expect(code).toContain('await expect(page).toHaveURL(/\\/account/);');
    expect(code).not.toContain('abc');
  });

  it('trims and sanitises a caller-provided test name, falling back when it is blank', async () => {
    const cart = session({ initialUrl: 'https://shop.example.com/cart?token=abc' });
    const events = [ev.navigation(0, 'https://shop.example.com/cart')];
    // The derived name starts with the initial route, without its query string.
    const blank = await generatePlaywrightTest({ session: cart, events, testName: '   ' });
    expect(blank.name).toBe('/cart: navigate to /cart completes');
    const messy = await generatePlaywrightTest({ session: cart, events, testName: '  Cart \n regression  ' });
    expect(messy.name).toBe('Cart regression');
    const long = await generatePlaywrightTest({ session: cart, events, testName: 'x'.repeat(500) });
    expect(long.name).toHaveLength(200);
  });
});

describe('describeAction', () => {
  it('uses the most human-meaningful name the recording captured', () => {
    const target = descriptor({ tag: 'input', name: 'email', placeholder: 'you@example.com', label: 'Email' });
    expect(describeAction({ kind: 'fill', seq: 1, ts: 0, target, value: 'x', masked: false })).toBe('fill "Email"');
    expect(describeAction({ kind: 'click', seq: 1, ts: 0, target: descriptor({ tag: 'div' }) })).toBe('click <div>');
    expect(describeAction({ kind: 'select', seq: 1, ts: 0, target, value: 'a' })).toBe('select "a" in "Email"');
    expect(describeAction({ kind: 'check', seq: 1, ts: 0, target, checked: false })).toBe('uncheck "Email"');
    expect(describeAction({ kind: 'navigate', seq: 0, ts: 0, url: 'https://a/b', path: '/b' })).toBe('navigate to /b');
  });
});

describe('formatOffset', () => {
  it('formats mm:ss.mmm and clamps negatives to zero', () => {
    expect(formatOffset(0)).toBe('00:00.000');
    expect(formatOffset(2140)).toBe('00:02.140');
    expect(formatOffset(61_005)).toBe('01:01.005');
    expect(formatOffset(3_599_999)).toBe('59:59.999');
    expect(formatOffset(-50)).toBe('00:00.000');
    expect(formatOffset(1234.6)).toBe('00:01.235');
  });
});

describe('fixture naming', () => {
  it('derives a camelCase fixture name from the best available field hint', () => {
    expect(fixtureName(descriptor({ tag: 'input', name: 'cardNumber' }), 1)).toBe('cardNumber');
    expect(fixtureName(descriptor({ tag: 'input', name: 'card_number' }), 1)).toBe('cardNumber');
    expect(fixtureName(descriptor({ tag: 'input', label: 'Card number' }), 1)).toBe('cardNumber');
    expect(fixtureName(descriptor({ tag: 'input', id: 'cc-number' }), 1)).toBe('ccNumber');
    expect(fixtureName(descriptor({ tag: 'input', name: 'pwd', label: 'Password' }), 1)).toBe('pwd');
  });

  it('falls back to the event seq when there is no readable hint', () => {
    expect(fixtureName(descriptor({ tag: 'input' }), 7)).toBe('field7');
    expect(fixtureName(descriptor({ tag: 'input', name: '123' }), 7)).toBe('field7');
    expect(fixtureName(descriptor({ tag: 'input', name: '!!!' }), 7)).toBe('field7');
  });

  it('maps a fixture name to the env var the generated helper reads', () => {
    expect(fixtureEnvVar('cardNumber')).toBe('REPRO_FIXTURE_CARD_NUMBER');
    expect(fixtureEnvVar('password')).toBe('REPRO_FIXTURE_PASSWORD');
    expect(fixtureEnvVar('field7')).toBe('REPRO_FIXTURE_FIELD7');
    expect(fixtureEnvVar('secretProcessExit1')).toBe('REPRO_FIXTURE_SECRET_PROCESS_EXIT1');
  });
});
