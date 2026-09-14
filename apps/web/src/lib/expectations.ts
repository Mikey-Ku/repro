import type { Expectation } from '@repro/contracts';

/**
 * Pure helpers for success expectations, shared by the builder and the
 * suggestions list so both describe an expectation with the same words.
 * No React and no server imports, so client components and tests can use it.
 */

/** The contract caps `expectations` at five per generate request. */
export const MAX_EXPECTATIONS = 5;

export function describeExpectation(expectation: Expectation): string {
  if (expectation.kind === 'url') return `URL starts with ${expectation.pathPrefix || '...'}`;
  if (expectation.kind === 'visible') {
    if (expectation.testId) return `Visible: test id "${expectation.testId}"`;
    if (expectation.role) return `Visible: ${expectation.role}${expectation.name ? ` "${expectation.name}"` : ''}`;
    if (expectation.text) return `Visible: text "${expectation.text}"`;
    return 'Visible: (empty)';
  }
  return 'No errors';
}

/** Structural equality; key order is fixed by the builders, so a string compare is enough. */
export function sameExpectation(a: Expectation, b: Expectation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
