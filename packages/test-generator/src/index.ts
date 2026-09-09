import { normalizeEvents, sanitizePath } from '@repro/contracts';
import prettier from 'prettier';
import { describeAction, emitTest } from './emit.js';
import { applyExpectations } from './expectations.js';
import { commentText } from './literal.js';
import { hashNormalizedInput } from './hash.js';
import type { GeneratorInput, GeneratorOutput } from './types.js';

export const GENERATOR_VERSION = '0.1.0';

export type { GeneratorInput, GeneratorOutput, SelectorReportEntry } from './types.js';
export type { SelectorChoice, SelectorStrategy } from './selectors.js';
export type { HashInput } from './hash.js';
export type { TestExpectation } from './expectations.js';
export { applyExpectations } from './expectations.js';
export { chooseSelector } from './selectors.js';
export { hashNormalizedInput, canonicalJson } from './hash.js';
export { stringLiteral, regexEscape, commentText } from './literal.js';
export { describeAction, fixtureName, fixtureEnvVar, formatOffset } from './emit.js';

/** Collapse whitespace and drop control characters so the name reads well in a test report. */
function sanitizeTestName(name: string): string {
  return commentText(name).slice(0, 200);
}

/**
 * Turn a recorded session into a Playwright test. The output depends only on the normalised
 * actions, the expectations, the test name and the session metadata that appears in the
 * header, so the same session always produces byte-identical code.
 */
export async function generatePlaywrightTest(input: GeneratorInput): Promise<GeneratorOutput> {
  const normalized = normalizeEvents(input.events);
  const expectationWarnings: string[] = [];
  const expectations = applyExpectations(input.expectations, expectationWarnings);

  const initialRoute = sanitizePath(input.session.initialUrl).split('?')[0] || '/';
  const lastAction = normalized.actions[normalized.actions.length - 1];
  const derivedName = lastAction
    ? `${initialRoute}: ${describeAction(lastAction)} completes`
    : `${initialRoute}: page loads without errors`;
  const testName = sanitizeTestName(input.testName?.trim() ? input.testName : derivedName);

  const sourceHash = hashNormalizedInput({
    generatorVersion: GENERATOR_VERSION,
    actions: normalized.actions,
    expectations,
    testName,
    initialUrl: input.session.initialUrl,
  });

  const emitted = emitTest({
    session: input.session,
    incident: input.incident ?? null,
    normalized,
    expectations,
    testName,
    generatorVersion: GENERATOR_VERSION,
    sourceHash,
  });

  // prettier throws on a syntax error, so a malformed emission fails loudly instead of
  // producing a test file that does not compile.
  const code = await prettier.format(emitted.code, {
    parser: 'typescript',
    singleQuote: true,
    semi: true,
    printWidth: 100,
  });

  return {
    code,
    name: testName,
    sourceHash,
    generatorVersion: GENERATOR_VERSION,
    selectors: emitted.selectors,
    omitted: emitted.omitted,
    warnings: [...expectationWarnings, ...emitted.warnings],
  };
}
