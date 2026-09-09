import { describe, expect, it } from 'vitest';
import { InvestigationSchema, buildTimeline } from '@repro/contracts';
import {
  createAiInvestigator,
  createFakeInvestigator,
  createInvestigatorFromEnv,
  redactForModel,
  summarizeEvidence,
  type GenerateFn,
  type InvestigatorInput,
} from '../src/index.js';
import { CANARY_TOKEN, STARTED_AT, serverErrorNoException, typeErrorAfterPost } from './fixtures/sessions.js';

const ctx = { startedAt: STARTED_AT };

function inputFor(events = typeErrorAfterPost()): InvestigatorInput {
  return { summary: summarizeEvidence(events, ctx), timeline: buildTimeline(events, STARTED_AT) };
}

describe('fake investigator', () => {
  it('blames the response shape after a 200 POST followed by a TypeError', async () => {
    const investigator = createFakeInvestigator();
    const result = await investigator.investigate(inputFor());
    expect(InvestigationSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ provider: 'fake', model: 'rules-v1', confidence: 'medium', abstained: false });
    expect(result.hypothesis).toBe('The response from POST /api/orders succeeded, but the page code read a property that is not in the response shape.');
    expect(result.inferences.length).toBeGreaterThan(0);
    expect(result.suggestedChecks.length).toBeGreaterThan(0);

    const refs = new Set(inputFor().summary.requestsBeforeError.map((r) => r.ref.seq));
    refs.add(inputFor().summary.earliestError!.ref.seq);
    for (const action of inputFor().summary.lastActions) refs.add(action.ref.seq);
    for (const entry of result.evidence) expect(refs.has(entry.ref.seq)).toBe(true);
  });

  it('abstains when there is no error at all', async () => {
    const result = await createFakeInvestigator().investigate(inputFor([]));
    expect(result.abstained).toBe(true);
    expect(result.hypothesis).toBeNull();
    expect(result.confidence).toBe('none');
    expect(result.abstainReason).toMatch(/No error was recorded/);
  });

  it('abstains for a 500 without an exception but keeps the failed request as evidence', async () => {
    const result = await createFakeInvestigator().investigate(inputFor(serverErrorNoException()));
    expect(result.abstained).toBe(true);
    expect(result.evidence).toEqual([expect.objectContaining({ claim: expect.stringContaining('GET /api/orders/42 failed with 500') })]);
  });

  it('is deterministic', async () => {
    const a = await createFakeInvestigator().investigate(inputFor());
    const b = await createFakeInvestigator().investigate(inputFor());
    expect(a).toEqual(b);
  });
});

describe('redactForModel', () => {
  it('drops event payloads, truncates details and scrubs canaries', () => {
    const input = inputFor();
    const redacted = redactForModel(input);
    const json = JSON.stringify(redacted);
    expect(json).not.toContain(CANARY_TOKEN);
    expect(json).not.toContain('"event"');
    expect(redacted.timeline).toHaveLength(input.timeline.length);
    for (const row of redacted.timeline) {
      expect(Object.keys(row).sort()).toEqual(expect.not.arrayContaining(['event']));
      if (row.detail) expect(row.detail.length).toBeLessThanOrEqual(301);
    }
    expect(redacted.summary.earliestError?.stack).toContain('[redacted]');
    // The original input is untouched.
    expect(JSON.stringify(input)).toContain(CANARY_TOKEN);
  });
});

describe('AI investigator (injected generate, no network)', () => {
  const validOutput = (input: InvestigatorInput) => ({
    hypothesis: 'The orders response lacks the field the page reads.',
    confidence: 'high',
    abstained: false,
    evidence: [
      { claim: 'The error happened after the POST.', ref: input.summary.earliestError!.ref },
      { claim: 'Made up.', ref: { seq: 999, ts: 1, offsetMs: 1, label: 'nope' } },
    ],
    inferences: ['The response shape changed.'],
    suggestedChecks: ['Diff the API response.'],
  });

  it('sends the redacted input, validates the output and drops unknown refs', async () => {
    const calls: Parameters<GenerateFn>[0][] = [];
    const input = inputFor();
    const generate: GenerateFn = async (args) => {
      calls.push(args);
      return validOutput(input);
    };
    const investigator = createAiInvestigator({ model: 'anthropic/claude-sonnet-4.5', generate });
    const result = await investigator.investigate(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toMatch(/abstain/i);
    expect(calls[0]?.system).toMatch(/evidence/i);
    expect(calls[0]?.prompt).not.toContain(CANARY_TOKEN);
    expect(calls[0]?.prompt).not.toContain('"event"');

    expect(InvestigationSchema.parse(result)).toEqual(result);
    expect(result.provider).toBe('ai-gateway');
    expect(result.model).toBe('anthropic/claude-sonnet-4.5');
    expect(result.evidence).toHaveLength(1);
    expect(result.inferences.at(-1)).toMatch(/1 evidence entry cited a ref that is not in the summary/);
  });

  it('abstains instead of throwing when the output is invalid', async () => {
    const investigator = createAiInvestigator({ model: 'test/model', generate: async () => ({ hypothesis: 42 }) });
    const result = await investigator.investigate(inputFor());
    expect(result.abstained).toBe(true);
    expect(result.hypothesis).toBeNull();
    expect(result.abstainReason).toMatch(/failed validation/);
    expect(InvestigationSchema.parse(result)).toEqual(result);
  });

  it('propagates transport errors so the caller can report them', async () => {
    const investigator = createAiInvestigator({
      model: 'test/model',
      generate: async () => {
        throw new Error('gateway unreachable');
      },
    });
    await expect(investigator.investigate(inputFor())).rejects.toThrow('gateway unreachable');
  });
});

describe('createInvestigatorFromEnv', () => {
  it('uses the fake unless both the key and the model are set', () => {
    expect(createInvestigatorFromEnv({}).provider).toBe('fake');
    expect(createInvestigatorFromEnv({ AI_GATEWAY_API_KEY: 'k' }).provider).toBe('fake');
    expect(createInvestigatorFromEnv({ REPRO_AI_MODEL: 'anthropic/claude-sonnet-4.5' }).provider).toBe('fake');
    const ai = createInvestigatorFromEnv({ AI_GATEWAY_API_KEY: 'k', REPRO_AI_MODEL: 'anthropic/claude-sonnet-4.5' });
    expect(ai.provider).toBe('ai-gateway');
    expect(ai.model).toBe('anthropic/claude-sonnet-4.5');
  });
});
