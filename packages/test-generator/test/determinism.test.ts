import { describe, expect, it } from 'vitest';
import type { RecordedEvent } from '@repro/contracts';
import { canonicalJson, generatePlaywrightTest, hashNormalizedInput } from '../src/index.js';
import { loadFixture } from './helpers.js';

/** A fixed permutation, so the "shuffled" test is itself deterministic. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  let state = 2_463_534_242;
  for (let i = out.length - 1; i > 0; i -= 1) {
    // xorshift32: cheap, repeatable and nothing to do with Math.random.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('determinism', () => {
  const input = loadFixture('checkout-broken');

  it('generates byte-identical code and the same hash for the same input', async () => {
    const first = await generatePlaywrightTest(input);
    const second = await generatePlaywrightTest(structuredClone(input));
    expect(second.code).toBe(first.code);
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second).toEqual(first);
  });

  it('does not depend on the order events arrive in', async () => {
    const ordered = await generatePlaywrightTest(input);
    const shuffled = await generatePlaywrightTest({ ...input, events: shuffle(input.events) });
    const reversed = await generatePlaywrightTest({ ...input, events: [...input.events].reverse() });
    expect(shuffled.code).toBe(ordered.code);
    expect(shuffled.sourceHash).toBe(ordered.sourceHash);
    expect(reversed).toEqual(ordered);
  });

  it('changes the hash and the code when one recorded value changes', async () => {
    const original = await generatePlaywrightTest(input);
    const events = structuredClone(input.events).map((e): RecordedEvent => {
      if (e.type === 'input' && e.data.value === 'SAVE10') e.data.value = 'SAVE20';
      return e;
    });
    const changed = await generatePlaywrightTest({ ...input, events });
    expect(changed.sourceHash).not.toBe(original.sourceHash);
    expect(changed.code).not.toBe(original.code);
    expect(changed.code).toContain("fill('SAVE20')");
  });

  it('changes the hash when the test name or an expectation changes', async () => {
    const original = await generatePlaywrightTest(input);
    const renamed = await generatePlaywrightTest({ ...input, testName: 'Checkout regression' });
    const differentExpectation = await generatePlaywrightTest({
      ...input,
      expectations: [{ kind: 'visible', testId: 'thank-you' }],
    });
    expect(renamed.sourceHash).not.toBe(original.sourceHash);
    expect(differentExpectation.sourceHash).not.toBe(original.sourceHash);
    expect(renamed.sourceHash).not.toBe(differentExpectation.sourceHash);
  });

  it('ignores timing: the same clicks at a different speed hash the same', async () => {
    const original = await generatePlaywrightTest(input);
    const slower = await generatePlaywrightTest({
      ...input,
      events: input.events.map((e) => ({ ...e, ts: e.ts + e.seq * 500 })),
    });
    expect(slower.sourceHash).toBe(original.sourceHash);
    // Only the offsets in the step comments differ.
    const stripOffsets = (code: string) => code.replace(/\(\d{2}:\d{2}\.\d{3}\)/g, '(offset)');
    expect(stripOffsets(slower.code)).toBe(stripOffsets(original.code));
    expect(slower.code).not.toBe(original.code);
  });

  it('ignores session metadata that only appears in the header', async () => {
    const original = await generatePlaywrightTest(input);
    const relabelled = await generatePlaywrightTest({
      ...input,
      session: { ...input.session, id: '99999999-9999-4999-8999-999999999999', release: 'other', browser: 'Edge' },
      incident: { id: 'inc_99', title: 'Different title', message: 'x' },
    });
    expect(relabelled.sourceHash).toBe(original.sourceHash);
    expect(relabelled.code).toContain('// Release: other');
  });

  it('emits no clock reads or randomness into the test', async () => {
    const { code } = await generatePlaywrightTest(input);
    expect(code).not.toMatch(/Date\.now|new Date\(|Math\.random|crypto\.|randomUUID/);
    // The only ISO timestamp is the recorded start in the header comment.
    const isoTimestamps = code.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g) ?? [];
    expect(isoTimestamps).toHaveLength(1);
    expect(code).toContain(`// Recorded: ${isoTimestamps[0]}`);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined members', () => {
    const a = { b: [{ z: 1, y: undefined, x: 2 }], a: 'x' };
    const b = { a: 'x', b: [{ x: 2, z: 1 }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":"x","b":[{"x":2,"z":1}]}');
  });

  it('keeps arrays in order and distinguishes null from missing', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({ a: undefined })).toBe('{}');
  });
});

describe('hashNormalizedInput', () => {
  const base = {
    generatorVersion: '0.1.0',
    actions: [{ kind: 'navigate' as const, seq: 0, ts: 1, url: 'https://a/', path: '/' }],
    expectations: [{ kind: 'no-errors' as const }],
    testName: 'name',
    initialUrl: 'https://a/',
  };

  it('is a hex sha256 that ignores timestamps', () => {
    const hash = hashNormalizedInput(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const later = { ...base, actions: [{ ...base.actions[0]!, ts: 999 }] };
    expect(hashNormalizedInput(later)).toBe(hash);
  });

  it('changes with the generator version, so old tests are regenerated after an upgrade', () => {
    expect(hashNormalizedInput({ ...base, generatorVersion: '0.2.0' })).not.toBe(hashNormalizedInput(base));
    expect(hashNormalizedInput({ ...base, initialUrl: 'https://b/' })).not.toBe(hashNormalizedInput(base));
  });
});
