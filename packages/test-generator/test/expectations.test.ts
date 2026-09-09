import { describe, expect, it } from 'vitest';
import type { Expectation } from '@repro/contracts';
import { applyExpectations, generatePlaywrightTest } from '../src/index.js';
import { descriptor, ev, linesOf, session } from './helpers.js';

/** A small session whose only purpose is to carry the expectations under test. */
const withExpectations = (expectations: Expectation[] | undefined) =>
  generatePlaywrightTest({
    session: session(),
    expectations,
    events: [
      ev.navigation(0, 'https://shop.example.com/'),
      ev.click(1, descriptor({ tag: 'button', role: 'button', accessibleName: 'Go' })),
    ],
  });

describe('applyExpectations', () => {
  it('always applies no-errors first, even when nothing was requested', () => {
    const warnings: string[] = [];
    expect(applyExpectations(undefined, warnings)).toEqual([{ kind: 'no-errors' }]);
    expect(applyExpectations([{ kind: 'url', pathPrefix: '/done' }], warnings)).toEqual([
      { kind: 'no-errors' },
      { kind: 'url', pathPrefix: '/done' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('narrows each kind and drops empty fields', () => {
    const warnings: string[] = [];
    const result = applyExpectations(
      [
        { kind: 'no-errors' },
        { kind: 'visible', testId: 'done', role: '', name: undefined },
        { kind: 'visible', role: 'heading', name: 'Thanks' },
        { kind: 'visible', text: 'Order placed' },
        { kind: 'url', pathPrefix: '/orders/' },
      ],
      warnings,
    );
    expect(result).toEqual([
      { kind: 'no-errors' },
      { kind: 'visible', testId: 'done' },
      { kind: 'visible', role: 'heading', name: 'Thanks' },
      { kind: 'visible', text: 'Order placed' },
      { kind: 'url', pathPrefix: '/orders/' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('drops duplicates, first one wins', () => {
    const result = applyExpectations(
      [
        { kind: 'url', pathPrefix: '/a' },
        { kind: 'url', pathPrefix: '/a' },
        { kind: 'no-errors' },
      ],
      [],
    );
    expect(result).toEqual([{ kind: 'no-errors' }, { kind: 'url', pathPrefix: '/a' }]);
  });

  it('warns about unusable entries instead of failing', () => {
    const warnings: string[] = [];
    const result = applyExpectations(
      [{ kind: 'teleport' } as unknown as Expectation, { kind: 'url', pathPrefix: '' }, null as unknown as Expectation],
      warnings,
    );
    expect(result).toEqual([{ kind: 'no-errors' }]);
    expect(warnings).toEqual([
      'Expectation 1 was ignored because its kind or fields were not recognised.',
      'Expectation 2 was ignored because its kind or fields were not recognised.',
      'Expectation 3 was ignored because its kind or fields were not recognised.',
    ]);
  });
});

describe('expectation code', () => {
  it('no-errors: the page error guard is always present and nothing else is added', async () => {
    const { code } = await withExpectations(undefined);
    const lines = linesOf(code);
    const success = lines.indexOf('// Success state. The recorded session failed here; a fixed build must reach it cleanly.');
    expect(lines.slice(success + 1)).toEqual([
      "await page.waitForLoadState('networkidle');",
      "expect(pageErrors, 'the workflow should complete without uncaught errors').toEqual([]);",
      '});',
    ]);
  });

  it('visible by test id', async () => {
    const { code } = await withExpectations([{ kind: 'visible', testId: 'order-confirmation' }]);
    expect(code).toContain("await expect(page.getByTestId('order-confirmation')).toBeVisible();");
  });

  it('visible by role and name', async () => {
    const { code } = await withExpectations([{ kind: 'visible', role: 'heading', name: 'Thank you' }]);
    expect(code).toContain("await expect(page.getByRole('heading', { name: 'Thank you', exact: true })).toBeVisible();");
    const roleOnly = await withExpectations([{ kind: 'visible', role: 'alert' }]);
    expect(roleOnly.code).toContain("await expect(page.getByRole('alert')).toBeVisible();");
  });

  it('visible by text, including when the role is not a real ARIA role', async () => {
    const { code } = await withExpectations([{ kind: 'visible', text: 'Order placed' }]);
    expect(code).toContain("await expect(page.getByText('Order placed')).toBeVisible();");
    const badRole = await withExpectations([{ kind: 'visible', role: 'banner-thing', text: 'Fallback text' }]);
    expect(badRole.code).toContain("page.getByText('Fallback text')");
    expect(badRole.code).not.toContain('banner-thing');
  });

  it('visible with nothing to look for is ignored with a warning', async () => {
    const { code, warnings } = await withExpectations([{ kind: 'visible' }]);
    expect(code).not.toContain('toBeVisible();\n  await page.waitForLoadState');
    expect(warnings).toContain('A visible expectation had no test id, role or text and was ignored.');
  });

  it('url: anchored regex of the escaped path prefix', async () => {
    const { code } = await withExpectations([{ kind: 'url', pathPrefix: '/orders/123?x=1' }]);
    expect(code).toContain("await expect(page).toHaveURL(new RegExp('^\\\\/orders\\\\/123\\\\?x=1'));");
  });

  it('emits expectations in the order they were given, after the last step', async () => {
    const { code } = await withExpectations([
      { kind: 'url', pathPrefix: '/done' },
      { kind: 'visible', testId: 'receipt' },
    ]);
    const lines = linesOf(code);
    const click = lines.findIndex((l) => l.includes('.click();'));
    const url = lines.findIndex((l) => l.includes("new RegExp('^\\\\/done')"));
    const visible = lines.findIndex((l) => l.includes("getByTestId('receipt')"));
    expect(click).toBeLessThan(url);
    expect(url).toBeLessThan(visible);
  });
});
