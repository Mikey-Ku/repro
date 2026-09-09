import type {
  ElementDescriptor,
  NetworkEvent,
  NormalizedAction,
  NormalizedSession,
  OmittedEvent,
  RecordedEvent,
} from '@repro/contracts';
import type { TestExpectation } from './expectations.js';
import { commentText, regexEscape, stringLiteral } from './literal.js';
import { chooseSelector, isAriaRole, type SelectorChoice } from './selectors.js';
import type { GeneratorInput, SelectorReportEntry } from './types.js';

export interface EmitContext {
  session: GeneratorInput['session'];
  incident: GeneratorInput['incident'];
  normalized: NormalizedSession;
  expectations: TestExpectation[];
  testName: string;
  generatorVersion: string;
  sourceHash: string;
}

export interface EmitResult {
  /** Unformatted TypeScript source. The caller runs prettier over it. */
  code: string;
  selectors: SelectorReportEntry[];
  omitted: OmittedEvent[];
  warnings: string[];
}

/** `mm:ss.mmm` since the session started, for the step comments. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** The most human-meaningful name the recording captured for an element. */
export function targetName(target: ElementDescriptor): string | undefined {
  return (
    target.accessibleName ??
    target.label ??
    target.ariaLabel ??
    target.text ??
    target.placeholder ??
    target.name ??
    target.id
  );
}

const quoted = (target: ElementDescriptor): string => {
  const name = targetName(target);
  return name ? `"${name}"` : `<${target.tag}>`;
};

/** One line describing an action, shared by step comments, the selector report and the test name. */
export function describeAction(action: NormalizedAction): string {
  switch (action.kind) {
    case 'navigate':
      return `navigate to ${action.path}`;
    case 'expect-url':
      return `expect URL ${action.path}`;
    case 'click':
      return `click ${quoted(action.target)}`;
    case 'fill':
      return `fill ${quoted(action.target)}`;
    case 'select':
      return action.value === null
        ? `select an option in ${quoted(action.target)}`
        : `select "${action.value}" in ${quoted(action.target)}`;
    case 'check':
      return `${action.checked ? 'check' : 'uncheck'} ${quoted(action.target)}`;
    case 'press-enter':
      return `press Enter in ${quoted(action.target)}`;
    case 'submit':
      return `submit form ${quoted(action.target)}`;
  }
}

/**
 * `cardNumber` from `card_number`, `Card number` or `cc-number`. Used to name the fixture that
 * stands in for a redacted value. Falls back to the event seq when nothing readable exists.
 */
export function fixtureName(target: ElementDescriptor, seq: number): string {
  const source =
    target.name ?? target.id ?? target.label ?? target.ariaLabel ?? target.placeholder ?? target.accessibleName ?? '';
  const words = source
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0 || /^\d/.test(words[0]!)) return `field${seq}`;
  return words.map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1))).join('');
}

/** `REPRO_FIXTURE_CARD_NUMBER` from `cardNumber`. Must match the helper emitted into the test. */
export function fixtureEnvVar(name: string): string {
  return `REPRO_FIXTURE_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

const FIXTURE_HELPER = [
  '// Values Repro redacted at capture time are replaced by fixtures. Provide each one through',
  '// the environment variable named in the comment next to its step.',
  'const fixture = (name: string) =>',
  "  process.env[`REPRO_FIXTURE_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`] ??",
  '  `REDACTED_${name}`;',
];

/** Input types whose change events the SDK records as masked "other" inputs with no usable value. */
const UNFILLABLE_INPUT_TYPES = new Set(['file', 'range', 'color']);

type Interaction = Exclude<NormalizedAction, { kind: 'navigate' | 'expect-url' }>;

const isInteraction = (action: NormalizedAction): action is Interaction =>
  action.kind !== 'navigate' && action.kind !== 'expect-url';

/** The recorded event type an action came from, for the omitted-event report. */
function eventTypeOf(action: NormalizedAction): RecordedEvent['type'] {
  switch (action.kind) {
    case 'navigate':
    case 'expect-url':
      return 'navigation';
    case 'click':
      return 'click';
    case 'fill':
    case 'select':
    case 'check':
      return 'input';
    case 'press-enter':
    case 'submit':
      return 'submit';
  }
}

type Resolved =
  | { kind: 'step'; action: NormalizedAction; selector: SelectorChoice | null; description: string }
  | { kind: 'skipped'; action: NormalizedAction; description: string; reason: string };

/**
 * Decide, for every action, whether it can be emitted and with which locator. Doing this
 * before writing any code lets the header report the omitted count and lets the network wait
 * wrap the last interaction that really gets emitted.
 */
function resolveActions(
  actions: readonly NormalizedAction[],
  selectors: SelectorReportEntry[],
  omitted: OmittedEvent[],
  warnings: string[],
): Resolved[] {
  return actions.map((action): Resolved => {
    const description = describeAction(action);
    if (!isInteraction(action)) return { kind: 'step', action, selector: null, description };

    if (action.kind === 'select' && action.value === null) {
      const reason = 'No option value was recorded for this select.';
      omitted.push({ seq: action.seq, type: 'input', reason });
      warnings.push(`Omitted ${description} (seq ${action.seq}): ${reason}`);
      return { kind: 'skipped', action, description, reason };
    }

    // The SDK records a change on these controls but never their value, and `fill` would not
    // reproduce them anyway (a file chooser, a slider drag, a colour picker).
    if (action.kind === 'fill' && UNFILLABLE_INPUT_TYPES.has((action.target.type ?? '').toLowerCase())) {
      const reason = `Changes to <input type="${action.target.type}"> cannot be replayed from a recording.`;
      omitted.push({ seq: action.seq, type: 'input', reason });
      warnings.push(`Omitted ${description} (seq ${action.seq}): ${reason}`);
      return { kind: 'skipped', action, description, reason };
    }

    const selector = chooseSelector(action.target);
    selectors.push({
      seq: action.seq,
      action: description,
      strategy: selector.strategy,
      selector: selector.code,
      ...(selector.note ? { note: selector.note } : {}),
    });
    if (selector.strategy === 'none') {
      const reason = selector.note ?? 'No stable selector was available.';
      omitted.push({ seq: action.seq, type: eventTypeOf(action), reason });
      warnings.push(`Omitted ${description} (seq ${action.seq}): ${reason}`);
      return { kind: 'skipped', action, description, reason };
    }
    if (selector.strategy === 'css') {
      warnings.push(`${description} (seq ${action.seq}) uses a CSS path fallback: ${selector.code}`);
    }
    return { kind: 'step', action, selector, description };
  });
}

/** The first emitted locator between a navigation and the next one, used to wait for the page. */
function firstSelectorOnPage(resolved: readonly Resolved[], fromIndex: number): string | undefined {
  for (let i = fromIndex + 1; i < resolved.length; i += 1) {
    const entry = resolved[i]!;
    if (!isInteraction(entry.action)) return undefined;
    if (entry.kind === 'step' && entry.selector) return entry.selector.code;
  }
  return undefined;
}

function pathnameOf(request: NetworkEvent): string {
  try {
    return new URL(request.data.url).pathname;
  } catch {
    return request.data.path.split('?')[0] ?? request.data.path;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The lines that perform one resolved step, without its comment. */
function stepCode(entry: Extract<Resolved, { kind: 'step' }>, warnings: string[]): string[] {
  const { action, selector } = entry;
  switch (action.kind) {
    case 'navigate':
      return [`await page.goto(${stringLiteral(action.path)});`];
    case 'expect-url': {
      const pathname = action.path.split('?')[0] ?? action.path;
      return [`await expect(page).toHaveURL(/${regexEscape(pathname)}/);`];
    }
    case 'click':
      return [`await ${selector!.code}.click();`];
    case 'fill': {
      if (action.masked) {
        const name = fixtureName(action.target, action.seq);
        return [
          `await ${selector!.code}.fill(fixture(${stringLiteral(name)})); // value redacted at capture; provide ${fixtureEnvVar(name)}`,
        ];
      }
      return [`await ${selector!.code}.fill(${stringLiteral(action.value ?? '')});`];
    }
    case 'select':
      return [`await ${selector!.code}.selectOption(${stringLiteral(action.value ?? '')});`];
    case 'check':
      return [`await ${selector!.code}.${action.checked ? 'check' : 'uncheck'}();`];
    case 'press-enter':
      return [`await ${selector!.code}.press('Enter');`];
    case 'submit':
      warnings.push(
        `${entry.description} (seq ${action.seq}) had no submit button; the form is submitted with requestSubmit().`,
      );
      return [
        '// No submit button was recorded for this form, so it is submitted directly.',
        `await ${selector!.code}.evaluate((form) => (form as HTMLFormElement).requestSubmit());`,
      ];
  }
}

function expectationCode(expectation: TestExpectation, warnings: string[]): string[] {
  switch (expectation.kind) {
    case 'no-errors':
      return [];
    case 'visible': {
      if (expectation.testId) {
        return [`await expect(page.getByTestId(${stringLiteral(expectation.testId)})).toBeVisible();`];
      }
      if (expectation.role && isAriaRole(expectation.role)) {
        const options = expectation.name ? `, { name: ${stringLiteral(expectation.name)}, exact: true }` : '';
        return [`await expect(page.getByRole(${stringLiteral(expectation.role)}${options})).toBeVisible();`];
      }
      if (expectation.text) {
        return [`await expect(page.getByText(${stringLiteral(expectation.text)})).toBeVisible();`];
      }
      warnings.push('A visible expectation had no test id, role or text and was ignored.');
      return [];
    }
    case 'url':
      return [`await expect(page).toHaveURL(new RegExp(${stringLiteral(`^${regexEscape(expectation.pathPrefix)}`)}));`];
  }
}

export function emitTest(ctx: EmitContext): EmitResult {
  const { session, normalized } = ctx;
  const selectors: SelectorReportEntry[] = [];
  const omitted: OmittedEvent[] = [...normalized.omitted];
  const warnings: string[] = [];

  const resolved = resolveActions(normalized.actions, selectors, omitted, warnings);
  if (normalized.actions.length === 0) {
    warnings.push('The session contains no user actions; the test only checks the initial page for errors.');
  }

  // The trailing request is awaited around the last interaction that is really emitted.
  const trailing = normalized.trailingRequests[0];
  let waitIndex = -1;
  for (let i = resolved.length - 1; i >= 0; i -= 1) {
    const entry = resolved[i]!;
    if (entry.kind === 'step' && isInteraction(entry.action)) {
      waitIndex = i;
      break;
    }
  }
  const networkWait = trailing && waitIndex >= 0 ? { request: trailing, index: waitIndex } : undefined;

  const usesFixture = resolved.some(
    (entry) => entry.kind === 'step' && entry.action.kind === 'fill' && entry.action.masked,
  );
  const omittedCount = omitted.length;

  const lines: string[] = [];
  const header = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`// ${label}: ${commentText(value)}`);
  };

  lines.push('// Generated by Repro. Do not edit by hand; regenerate it from the session instead.');
  header('Session', session.id);
  header('Project', session.projectSlug);
  header('Recorded', new Date(session.startedAt).toISOString());
  header('Release', session.release ?? 'unknown');
  header('Browser', session.browser ?? 'unknown');
  header('Incident', ctx.incident?.title);
  header('Dashboard', session.dashboardUrl);
  header('Generator', `@repro/test-generator ${ctx.generatorVersion}`);
  header('Source hash', ctx.sourceHash);
  lines.push(
    `// Omitted events: ${omittedCount}${omittedCount ? ' (each one is listed with its reason in the Repro dashboard)' : ''}`,
  );
  lines.push('');
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');
  if (usesFixture) {
    lines.push(...FIXTURE_HELPER);
    lines.push('');
  }

  lines.push(`test(${stringLiteral(ctx.testName)}, async ({ page }) => {`);
  lines.push('const pageErrors: string[] = [];');
  lines.push("page.on('pageerror', (error) => pageErrors.push(String(error)));");

  let step = 0;
  resolved.forEach((entry, index) => {
    lines.push('');
    const offset = formatOffset(entry.action.ts - session.startedAt);
    if (entry.kind === 'skipped') {
      lines.push(`// Skipped ${commentText(entry.description)} (seq ${entry.action.seq}): ${commentText(entry.reason)}`);
      return;
    }
    step += 1;
    lines.push(`// Step ${step} (${offset}): ${commentText(entry.description)}`);
    if (entry.action.kind === 'navigate') {
      lines.push(`// Recorded origin: ${commentText(originOf(entry.action.url))}`);
    }
    if (networkWait && networkWait.index === index) {
      const method = networkWait.request.data.method.toUpperCase();
      const pathname = pathnameOf(networkWait.request);
      lines.push(`// The recording shows ${commentText(`${method} ${pathname}`)} after this step; wait for it below.`);
      lines.push(
        `const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === ${stringLiteral(pathname)} && response.request().method() === ${stringLiteral(method)});`,
      );
    }
    lines.push(...stepCode(entry, warnings));
    if (entry.action.kind === 'navigate') {
      const first = firstSelectorOnPage(resolved, index);
      if (first) lines.push(`await expect(${first}).toBeVisible();`);
    }
    if (networkWait && networkWait.index === index) {
      const method = networkWait.request.data.method.toUpperCase();
      const pathname = pathnameOf(networkWait.request);
      lines.push('const response = await responsePromise;');
      lines.push(`expect(response.ok(), ${stringLiteral(`${method} ${pathname} should succeed`)}).toBeTruthy();`);
    }
  });

  lines.push('');
  lines.push('// Success state. The recorded session failed here; a fixed build must reach it cleanly.');
  for (const expectation of ctx.expectations) {
    lines.push(...expectationCode(expectation, warnings));
  }
  if (normalized.firstError) {
    const { name, message } = normalized.firstError.data;
    lines.push(`// Recorded error: ${commentText(`${name ?? 'Error'}: ${message}`)}`);
  }
  lines.push("await page.waitForLoadState('networkidle');");
  lines.push("expect(pageErrors, 'the workflow should complete without uncaught errors').toEqual([]);");
  lines.push('});');
  lines.push('');

  omitted.sort((a, b) => a.seq - b.seq);
  return { code: lines.join('\n'), selectors, omitted, warnings };
}
