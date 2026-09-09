import { createHash } from 'node:crypto';
import type { NormalizedAction } from '@repro/contracts';
import type { TestExpectation } from './expectations.js';

export interface HashInput {
  generatorVersion: string;
  actions: readonly NormalizedAction[];
  expectations: readonly TestExpectation[];
  testName: string;
  initialUrl: string;
}

/**
 * JSON with object keys sorted at every level and `undefined` members dropped, so two
 * structurally equal inputs always serialise to the same bytes regardless of the order in
 * which their properties were assigned.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The identity of a generated test. Timestamps are excluded because they carry no meaning
 * for the test: two recordings of the same clicks at different speeds are the same test.
 */
export function hashNormalizedInput(input: HashInput): string {
  const actions = input.actions.map(({ ts: _ts, ...rest }) => rest);
  const canonical = canonicalJson({
    generatorVersion: input.generatorVersion,
    actions,
    expectations: input.expectations,
    testName: input.testName,
    initialUrl: input.initialUrl,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
