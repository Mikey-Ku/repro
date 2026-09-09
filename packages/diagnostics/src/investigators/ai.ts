import { InvestigationSchema, type EvidenceRef, type Investigation } from '@repro/contracts';
import { NoObjectGeneratedError, Output, createGateway, generateText } from 'ai';
import type { z } from 'zod';
import { redactForModel, type ModelInput } from './redact.js';
import type { Investigator, InvestigatorInput } from './types.js';

export const AI_PROVIDER = 'ai-gateway';

/** What the model must produce. Provider and model are filled in by us, never by the model. */
export const ModelOutputSchema = InvestigationSchema.omit({ provider: true, model: true });
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/**
 * The single network-touching function. Tests inject a fake; production uses `generateText`
 * with structured output through the Vercel AI Gateway.
 */
export type GenerateFn = (args: { system: string; prompt: string; schema: typeof ModelOutputSchema }) => Promise<unknown>;

export interface AiInvestigatorOptions {
  /** Gateway model string such as 'anthropic/claude-sonnet-4.5'. */
  model: string;
  /** Overrides AI_GATEWAY_API_KEY. */
  apiKey?: string;
  /** Test seam. When omitted the real AI SDK call is used. */
  generate?: GenerateFn;
}

export const SYSTEM_PROMPT = [
  'You are a debugging assistant for a browser session replay tool.',
  'You receive a deterministic evidence summary and a redacted timeline of one recorded session.',
  'Your job is to propose the most likely root cause of the earliest error, or to abstain.',
  '',
  'Rules:',
  '1. Separate evidence from inference. An evidence entry is a fact taken from the summary and MUST carry the exact ref',
  '   (seq, ts, offsetMs, label) of the summary entry it comes from. Never invent refs.',
  '2. Put every reasoning step that goes beyond a recorded fact in `inferences`.',
  '3. State `confidence` honestly: high only when the evidence leaves little room for alternatives.',
  '4. If the evidence is insufficient (for example there is no error, or nothing links the error to an action or request),',
  '   set `abstained` to true, `hypothesis` to null, `confidence` to "none" and explain why in `abstainReason`.',
  '5. `suggestedChecks` are concrete actions an engineer can take to confirm or refute the hypothesis.',
  '6. Do not speculate about user identity or data. Values in the input may already be redacted.',
].join('\n');

function buildPrompt(input: ModelInput): string {
  return ['Evidence summary (JSON):', JSON.stringify(input.summary), '', 'Timeline (JSON, oldest first):', JSON.stringify(input.timeline)].join('\n');
}

const refKey = (ref: EvidenceRef): string => `${ref.seq}:${ref.ts}:${ref.offsetMs}`;

/** Every ref the summary exposes. Anything the model cites must be one of these. */
export function summaryRefs(summary: ModelInput['summary']): Set<string> {
  const keys = new Set<string>();
  if (summary.earliestError) keys.add(refKey(summary.earliestError.ref));
  for (const list of [summary.failedRequests, summary.slowRequests, summary.lastActions, summary.consoleErrors, summary.requestsBeforeError]) {
    for (const item of list) keys.add(refKey(item.ref));
  }
  return keys;
}

function abstained(model: string, reason: string): Investigation {
  return {
    provider: AI_PROVIDER,
    model,
    hypothesis: null,
    confidence: 'none',
    abstained: true,
    abstainReason: reason,
    evidence: [],
    inferences: [],
    suggestedChecks: [],
  };
}

/** Keep the model honest: drop evidence whose ref does not exist and say so in the inferences. */
export function postValidate(output: ModelOutput, allowed: Set<string>, model: string): Investigation {
  const kept = output.evidence.filter((e) => allowed.has(refKey(e.ref)));
  const dropped = output.evidence.length - kept.length;
  const inferences = [...output.inferences];
  if (dropped > 0) {
    inferences.push(`Warning: ${dropped} evidence entr${dropped === 1 ? 'y' : 'ies'} cited a ref that is not in the summary and ${dropped === 1 ? 'was' : 'were'} removed.`);
  }
  return { ...output, provider: AI_PROVIDER, model, evidence: kept, inferences };
}

const MAX_TIMELINE_ROWS = 200;

/** Cap the timeline so a long session does not blow the context window. Rows up to the error win. */
function trimTimeline(input: ModelInput): ModelInput {
  if (input.timeline.length <= MAX_TIMELINE_ROWS) return input;
  const errorSeq = input.summary.earliestError?.ref.seq;
  const cut = errorSeq === undefined ? input.timeline.length : input.timeline.findIndex((row) => row.seq > errorSeq);
  const end = cut === -1 ? input.timeline.length : Math.min(input.timeline.length, cut + 20);
  return { ...input, timeline: input.timeline.slice(Math.max(0, end - MAX_TIMELINE_ROWS), end) };
}

function defaultGenerate(model: string, apiKey?: string): GenerateFn {
  return async ({ system, prompt, schema }) => {
    // A plain string model id resolves through the gateway using AI_GATEWAY_API_KEY.
    // An explicit key gets its own gateway instance so the env var is not required.
    const languageModel = apiKey ? createGateway({ apiKey })(model) : model;
    const result = await generateText({
      model: languageModel,
      system,
      prompt,
      output: Output.object({ schema, name: 'investigation' }),
      maxRetries: 1,
    });
    return result.output;
  };
}

export function createAiInvestigator(options: AiInvestigatorOptions): Investigator {
  const { model } = options;
  const generate = options.generate ?? defaultGenerate(model, options.apiKey);
  return {
    provider: AI_PROVIDER,
    model,
    async investigate(input: InvestigatorInput): Promise<Investigation> {
      const redacted = trimTimeline(redactForModel(input));
      let raw: unknown;
      try {
        raw = await generate({ system: SYSTEM_PROMPT, prompt: buildPrompt(redacted), schema: ModelOutputSchema });
      } catch (error) {
        // The SDK could not turn the model text into the requested object. That is a validation
        // failure from our point of view, so we abstain instead of failing the whole request.
        if (NoObjectGeneratedError.isInstance(error)) {
          return abstained(model, `The model did not return a valid investigation: ${error.message}`);
        }
        throw error;
      }
      const parsed = ModelOutputSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        return abstained(model, `The model output failed validation: ${issues}`);
      }
      return postValidate(parsed.data, summaryRefs(redacted.summary), model);
    },
  };
}
