import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordedEventSchema, type ElementDescriptor, type Expectation, type RecordedEvent } from '@repro/contracts';
import ts from 'typescript';
import type { GeneratorInput } from '../src/index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const fixturePath = (name: string): string => join(fixturesDir, name);

/**
 * Load a recorded session fixture. Events are validated against the real contract schema so
 * a fixture that drifts from what the SDK can produce fails loudly here instead of silently
 * exercising an impossible input.
 */
export function loadFixture(name: string): GeneratorInput {
  const raw = JSON.parse(readFileSync(fixturePath(`${name}.json`), 'utf8')) as Omit<GeneratorInput, 'events'> & {
    events: unknown[];
  };
  const events = RecordedEventSchema.array().parse(raw.events);
  return {
    ...raw,
    events,
    // ExpectationSchema cannot be used to validate this today (see src/expectations.ts).
    expectations: raw.expectations as Expectation[] | undefined,
  };
}

/** A minimal element descriptor. `sensitive` is required by the contract, everything else is optional. */
export const descriptor = (overrides: Partial<ElementDescriptor> & { tag: string }): ElementDescriptor => ({
  sensitive: false,
  ...overrides,
});

export const SESSION_START = 1_757_400_000_000;

/** Session metadata with sensible defaults, for synthetic sessions built inline in a test. */
export const session = (overrides: Partial<GeneratorInput['session']> = {}): GeneratorInput['session'] => ({
  id: '11111111-2222-4333-8444-555555555555',
  projectSlug: 'demo',
  startedAt: SESSION_START,
  initialUrl: 'https://shop.example.com/',
  ...overrides,
});

/**
 * Build one recorded event. `ts` defaults to one second per seq after the session start so
 * step comments get predictable offsets. The result is validated against the contract schema.
 */
export function event(seq: number, type: RecordedEvent['type'], data: unknown, ts = SESSION_START + seq * 1000): RecordedEvent {
  return RecordedEventSchema.parse({ seq, ts, type, data });
}

/** Shorthand builders for the event shapes the generator cares about. */
export const ev = {
  navigation: (seq: number, url: string, kind: 'load' | 'push' = seq === 0 ? 'load' : 'push') =>
    event(seq, 'navigation', { url, kind }),
  click: (seq: number, target: ElementDescriptor) => event(seq, 'click', { target, x: 1, y: 1 }),
  fill: (seq: number, target: ElementDescriptor, value: string | null, masked = false) =>
    event(seq, 'input', { target, kind: 'text', value, masked }),
  select: (seq: number, target: ElementDescriptor, value: string | null) =>
    event(seq, 'input', { target, kind: 'select', value, masked: false }),
  checkbox: (seq: number, target: ElementDescriptor, checked: boolean) =>
    event(seq, 'input', { target, kind: 'checkbox', value: 'on', masked: false, checked }),
  submit: (seq: number, target: ElementDescriptor) => event(seq, 'submit', { target }),
  network: (seq: number, method: string, url: string, ok = true) =>
    event(seq, 'network', {
      kind: 'fetch',
      method,
      url,
      path: new URL(url).pathname + new URL(url).search,
      status: ok ? 200 : 500,
      ok,
      durationMs: 50,
      requestId: `req_${seq}`,
    }),
  error: (seq: number, message: string) =>
    event(seq, 'error', { kind: 'exception', name: 'Error', message, handled: false }),
};

/** Parse generated code with the TypeScript compiler and return its syntax errors, if any. */
export function parseErrorsOf(code: string): string[] {
  const file = ts.createSourceFile('generated.spec.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // parseDiagnostics is not part of the public typings but is always populated by createSourceFile.
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/**
 * Every identifier that appears in the generated code as code (not inside a string, template,
 * regex or comment). Recorded text can only ever be data, so nothing typed by a user should
 * show up here. Property names are included, so `process.exit` yields both `process` and `exit`.
 */
export function identifiersOf(code: string): string[] {
  const file = ts.createSourceFile('generated.spec.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** The text of every string, template and regex literal in the code, in source order. */
export function literalsOf(code: string): string[] {
  const file = ts.createSourceFile('generated.spec.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text);
    else if (ts.isRegularExpressionLiteral(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

/** Non-empty lines of the generated code, trimmed, for order assertions. */
export const linesOf = (code: string): string[] =>
  code
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** Index of the first line containing `needle`, or -1. */
export const lineIndex = (lines: readonly string[], needle: string): number =>
  lines.findIndex((line) => line.includes(needle));
