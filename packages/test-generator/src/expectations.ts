import type { Expectation } from '@repro/contracts';

/**
 * The expectations the generator understands, as a proper discriminated union.
 *
 * `ExpectationSchema` in @repro/contracts declares its `kind` members as raw strings instead
 * of `z.literal(...)`, so the inferred `Expectation` type has `kind: unknown` and cannot be
 * narrowed. Until that is fixed upstream, every incoming expectation is checked here and
 * converted into this local shape. The shapes are structurally compatible, so callers can keep
 * passing the contract type.
 */
export type TestExpectation =
  | { kind: 'no-errors' }
  | { kind: 'visible'; testId?: string; role?: string; name?: string; text?: string }
  | { kind: 'url'; pathPrefix: string };

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

function narrowExpectation(raw: Expectation): TestExpectation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  switch (record.kind) {
    case 'no-errors':
      return { kind: 'no-errors' };
    case 'visible': {
      const visible: TestExpectation = { kind: 'visible' };
      const testId = optionalString(record.testId);
      const role = optionalString(record.role);
      const name = optionalString(record.name);
      const text = optionalString(record.text);
      if (testId) visible.testId = testId;
      if (role) visible.role = role;
      if (name) visible.name = name;
      if (text) visible.text = text;
      return visible;
    }
    case 'url': {
      const pathPrefix = optionalString(record.pathPrefix);
      return pathPrefix ? { kind: 'url', pathPrefix } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * `no-errors` is always applied and always comes first. Duplicates are dropped (first wins) and
 * unusable entries are reported as warnings instead of failing generation.
 */
export function applyExpectations(
  requested: readonly Expectation[] | undefined,
  warnings: string[],
): TestExpectation[] {
  const seen = new Set<string>();
  const result: TestExpectation[] = [];
  const candidates: (TestExpectation | undefined)[] = [
    { kind: 'no-errors' },
    ...(requested ?? []).map((raw, index) => {
      const narrowed = narrowExpectation(raw);
      if (!narrowed) warnings.push(`Expectation ${index + 1} was ignored because its kind or fields were not recognised.`);
      return narrowed;
    }),
  ];
  for (const expectation of candidates) {
    if (!expectation) continue;
    const key = JSON.stringify(expectation);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(expectation);
  }
  return result;
}
