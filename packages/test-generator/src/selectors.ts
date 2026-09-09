import type { ElementDescriptor } from '@repro/contracts';
import { cssAttributeValue, isPlainCssIdentifier, stringLiteral } from './literal.js';

export type SelectorStrategy = 'testid' | 'role' | 'label' | 'placeholder' | 'attribute' | 'css' | 'none';

export interface SelectorChoice {
  strategy: SelectorStrategy;
  /** A Playwright locator expression such as `page.getByTestId('promo-code')`. Empty for `none`. */
  code: string;
  /** Explains a weaker choice (css fallback, form scoping) or why nothing was chosen. */
  note?: string;
}

/**
 * Roles Playwright's `getByRole` accepts. A recorded role outside this list is ignored so the
 * generated test never calls `getByRole` with a value that would throw at runtime.
 */
const ARIA_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

/** True when `getByRole` would accept `role` without throwing. */
export function isAriaRole(role: string): boolean {
  return ARIA_ROLES.has(role.toLowerCase());
}

/**
 * The role a browser assigns to a native control when no `role` attribute is present.
 * Mirrors the mapping Playwright uses for `getByRole`, so a recorded `<button>` without an
 * explicit role still gets the most readable selector.
 */
function implicitRole(target: ElementDescriptor): string | undefined {
  const tag = target.tag.toLowerCase();
  const type = (target.type ?? '').toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return target.href ? 'link' : undefined;
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input': {
      const byType: Record<string, string> = {
        button: 'button',
        checkbox: 'checkbox',
        image: 'button',
        number: 'spinbutton',
        radio: 'radio',
        range: 'slider',
        reset: 'button',
        search: 'searchbox',
        submit: 'button',
      };
      if (type === 'hidden') return undefined;
      return byType[type] ?? 'textbox';
    }
    default:
      return undefined;
  }
}

/**
 * Ids produced by UI libraries at render time (React `useId`, Radix, Headless UI, MUI) or ids
 * that end in a long run of digits change between page loads and would make the test flaky.
 */
function looksGenerated(id: string): boolean {
  return /^:/.test(id) || /^(radix|headlessui|mui|react|downshift|rc)[-_:]/i.test(id) || /\d{4,}$/.test(id);
}

/** The CSS form scope for a control that has no id of its own, if the recording captured one. */
function formScope(target: ElementDescriptor): string | undefined {
  if (target.formTestId) return `[data-testid=${cssAttributeValue(target.formTestId)}]`;
  if (target.formId) {
    return isPlainCssIdentifier(target.formId) ? `form#${target.formId}` : `form[id=${cssAttributeValue(target.formId)}]`;
  }
  return undefined;
}

/**
 * Pick the most stable Playwright locator for a recorded element. Strategies are tried in
 * order and the first match wins; the order is documented in docs/TEST_GENERATION.md.
 * The descriptor carries no rrweb node ids, and nothing here derives one.
 */
export function chooseSelector(target: ElementDescriptor): SelectorChoice {
  // 1. Test ids exist for exactly this purpose.
  if (target.testId) {
    return { strategy: 'testid', code: `page.getByTestId(${stringLiteral(target.testId)})` };
  }

  // 2. Role plus accessible name: what a user or a screen reader would look for.
  const role = (target.role ?? implicitRole(target) ?? '').toLowerCase();
  const accessibleName = target.accessibleName ?? target.ariaLabel;
  if (role && ARIA_ROLES.has(role) && accessibleName) {
    return {
      strategy: 'role',
      code: `page.getByRole(${stringLiteral(role)}, { name: ${stringLiteral(accessibleName)}, exact: true })`,
    };
  }

  // 3. The visible label of a form control.
  if (target.label) {
    return { strategy: 'label', code: `page.getByLabel(${stringLiteral(target.label)})` };
  }

  // 4. Placeholder text.
  if (target.placeholder) {
    return { strategy: 'placeholder', code: `page.getByPlaceholder(${stringLiteral(target.placeholder)})` };
  }

  // 5. Stable attributes: an author-written id, or a name attribute scoped to its form.
  if (target.id && !looksGenerated(target.id)) {
    const selector = isPlainCssIdentifier(target.id) ? `#${target.id}` : `[id=${cssAttributeValue(target.id)}]`;
    return { strategy: 'attribute', code: `page.locator(${stringLiteral(selector)})` };
  }
  if (target.name) {
    const control = `${target.tag.toLowerCase()}[name=${cssAttributeValue(target.name)}]`;
    const scope = formScope(target);
    const selector = scope ? `${scope} ${control}` : control;
    return {
      strategy: 'attribute',
      code: `page.locator(${stringLiteral(selector)})`,
      note: scope ? `Scoped to its form because the control has no id of its own.` : undefined,
    };
  }

  // 6. The recorded CSS path. It works today but breaks as soon as the markup changes.
  if (target.cssPath) {
    return {
      strategy: 'css',
      code: `page.locator(${stringLiteral(target.cssPath)})`,
      note: 'Fallback to the recorded CSS path; this selector may be brittle. Add a data-testid to the element for a stable test.',
    };
  }

  // 7. Nothing usable was recorded.
  return {
    strategy: 'none',
    code: '',
    note: `No stable selector was available for <${target.tag}> (no test id, role with name, label, placeholder, id, name or CSS path).`,
  };
}
