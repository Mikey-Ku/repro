import { describe, expect, it } from 'vitest';
import { chooseSelector } from '../src/index.js';
import { descriptor } from './helpers.js';

/** An element that qualifies for every strategy at once, so removing fields walks down the list. */
const everything = descriptor({
  tag: 'input',
  testId: 'email-field',
  role: 'textbox',
  accessibleName: 'Email address',
  label: 'Email',
  placeholder: 'you@example.com',
  id: 'email',
  name: 'email',
  cssPath: 'form > div > input',
  formId: 'signup',
});

describe('chooseSelector strategies', () => {
  it('testid: getByTestId', () => {
    expect(chooseSelector(descriptor({ tag: 'button', testId: 'submit-order' }))).toEqual({
      strategy: 'testid',
      code: "page.getByTestId('submit-order')",
    });
  });

  it('role: getByRole with an exact accessible name', () => {
    expect(chooseSelector(descriptor({ tag: 'button', role: 'button', accessibleName: 'Place order' }))).toEqual({
      strategy: 'role',
      code: "page.getByRole('button', { name: 'Place order', exact: true })",
    });
  });

  it('role: aria-label counts as the accessible name', () => {
    const choice = chooseSelector(descriptor({ tag: 'button', role: 'button', ariaLabel: 'Close dialog' }));
    expect(choice.code).toBe("page.getByRole('button', { name: 'Close dialog', exact: true })");
  });

  it('role: native controls get their implicit role', () => {
    const cases: [Parameters<typeof descriptor>[0], string][] = [
      [{ tag: 'button', accessibleName: 'Go' }, "page.getByRole('button', { name: 'Go', exact: true })"],
      [{ tag: 'select', accessibleName: 'Country' }, "page.getByRole('combobox', { name: 'Country', exact: true })"],
      [{ tag: 'textarea', accessibleName: 'Notes' }, "page.getByRole('textbox', { name: 'Notes', exact: true })"],
      [{ tag: 'input', type: 'checkbox', accessibleName: 'Agree' }, "page.getByRole('checkbox', { name: 'Agree', exact: true })"],
      [{ tag: 'input', type: 'search', accessibleName: 'Find' }, "page.getByRole('searchbox', { name: 'Find', exact: true })"],
      [{ tag: 'input', type: 'email', accessibleName: 'Email' }, "page.getByRole('textbox', { name: 'Email', exact: true })"],
      [{ tag: 'a', href: '/cart', accessibleName: 'Cart' }, "page.getByRole('link', { name: 'Cart', exact: true })"],
    ];
    for (const [target, code] of cases) {
      expect(chooseSelector(descriptor(target))).toEqual({ strategy: 'role', code });
    }
  });

  it('role: is skipped when the role is not one getByRole accepts, or when there is no name', () => {
    const unknownRole = chooseSelector(descriptor({ tag: 'div', role: 'fancy-widget', accessibleName: 'X', label: 'Fallback' }));
    expect(unknownRole.strategy).toBe('label');
    const noName = chooseSelector(descriptor({ tag: 'button', role: 'button', id: 'go' }));
    expect(noName).toEqual({ strategy: 'attribute', code: "page.locator('#go')" });
    const anchorWithoutHref = chooseSelector(descriptor({ tag: 'a', accessibleName: 'Nope', cssPath: 'a' }));
    expect(anchorWithoutHref.strategy).toBe('css');
    const hiddenInput = chooseSelector(descriptor({ tag: 'input', type: 'hidden', accessibleName: 'x', name: 'csrf' }));
    expect(hiddenInput.strategy).toBe('attribute');
  });

  it('label: getByLabel', () => {
    expect(chooseSelector(descriptor({ tag: 'input', label: 'Card number' }))).toEqual({
      strategy: 'label',
      code: "page.getByLabel('Card number')",
    });
  });

  it('placeholder: getByPlaceholder', () => {
    expect(chooseSelector(descriptor({ tag: 'input', placeholder: 'Search' }))).toEqual({
      strategy: 'placeholder',
      code: "page.getByPlaceholder('Search')",
    });
  });

  it('attribute: an author-written id', () => {
    expect(chooseSelector(descriptor({ tag: 'input', id: 'postal-code', name: 'postal' }))).toEqual({
      strategy: 'attribute',
      code: "page.locator('#postal-code')",
    });
  });

  it('attribute: ids that are not plain CSS identifiers are quoted', () => {
    expect(chooseSelector(descriptor({ tag: 'input', id: '1st field' })).code).toBe('page.locator(\'[id="1st field"]\')');
  });

  it('attribute: ids that look generated at render time are ignored', () => {
    for (const id of [':r1:', 'radix-:r3:', 'headlessui-listbox-button-12', 'mui-4', 'input-123456', 'react-select-2-input']) {
      const choice = chooseSelector(descriptor({ tag: 'input', id, name: 'city', formId: 'address' }));
      expect(choice.strategy, id).toBe('attribute');
      expect(choice.code, id).toBe('page.locator(\'form#address input[name="city"]\')');
    }
  });

  it('attribute: a name is scoped to its form, and the note says why', () => {
    const scopedById = chooseSelector(descriptor({ tag: 'input', name: 'city', formId: 'address' }));
    expect(scopedById).toEqual({
      strategy: 'attribute',
      code: 'page.locator(\'form#address input[name="city"]\')',
      note: 'Scoped to its form because the control has no id of its own.',
    });
    const scopedByTestId = chooseSelector(descriptor({ tag: 'select', name: 'country', formTestId: 'address-form' }));
    expect(scopedByTestId.code).toBe('page.locator(\'[data-testid="address-form"] select[name="country"]\')');
    const oddFormId = chooseSelector(descriptor({ tag: 'input', name: 'q', formId: 'form with spaces' }));
    expect(oddFormId.code).toBe('page.locator(\'form[id="form with spaces"] input[name="q"]\')');
  });

  it('attribute: a name outside any form is used on its own, without a note', () => {
    expect(chooseSelector(descriptor({ tag: 'input', name: 'q' }))).toEqual({
      strategy: 'attribute',
      code: 'page.locator(\'input[name="q"]\')',
      note: undefined,
    });
  });

  it('css: the recorded path, flagged as brittle', () => {
    const choice = chooseSelector(descriptor({ tag: 'div', cssPath: 'main > div.hero > div:nth-child(2)' }));
    expect(choice.strategy).toBe('css');
    expect(choice.code).toBe("page.locator('main > div.hero > div:nth-child(2)')");
    expect(choice.note).toMatch(/brittle/);
    expect(choice.note).toMatch(/data-testid/);
  });

  it('none: nothing usable was recorded', () => {
    const choice = chooseSelector(descriptor({ tag: 'span' }));
    expect(choice.strategy).toBe('none');
    expect(choice.code).toBe('');
    expect(choice.note).toMatch(/No stable selector was available for <span>/);
  });
});

describe('chooseSelector priority', () => {
  it('prefers testid > role+name > label > placeholder > attribute > css > none', () => {
    const steps: [keyof typeof everything, string][] = [
      ['testId', 'testid'],
      ['accessibleName', 'role'],
      ['label', 'label'],
      ['placeholder', 'placeholder'],
      ['id', 'attribute'],
      ['name', 'attribute'],
      ['cssPath', 'css'],
    ];
    let target = { ...everything };
    const seen: string[] = [];
    for (const [field, expected] of steps) {
      const choice = chooseSelector(target);
      expect(choice.strategy, `with ${field} present`).toBe(expected);
      seen.push(choice.code);
      target = { ...target, [field]: undefined };
    }
    expect(chooseSelector(target).strategy).toBe('none');
    // Each level produced a different locator, so the field really was the deciding one.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('never derives anything from an rrweb node id, because the descriptor has none', () => {
    const choice = chooseSelector({ ...everything, ...({ nodeId: 42 } as object) });
    expect(choice.code).not.toContain('42');
  });

  it('escapes recorded text inside every locator it builds', () => {
    const hostile = "'); require('child_process') //";
    const choices = [
      chooseSelector(descriptor({ tag: 'div', testId: hostile })),
      chooseSelector(descriptor({ tag: 'button', role: 'button', accessibleName: hostile })),
      chooseSelector(descriptor({ tag: 'input', label: hostile })),
      chooseSelector(descriptor({ tag: 'input', placeholder: hostile })),
      chooseSelector(descriptor({ tag: 'input', id: hostile })),
      chooseSelector(descriptor({ tag: 'input', name: hostile, formId: hostile })),
      chooseSelector(descriptor({ tag: 'div', cssPath: hostile })),
    ];
    for (const choice of choices) {
      // The single quote that would close the literal is always escaped.
      expect(choice.code).toContain("\\')");
      expect(choice.code).not.toMatch(/[^\\]'\); require/);
    }
  });
});
