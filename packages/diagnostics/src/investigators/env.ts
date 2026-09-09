import { createAiInvestigator } from './ai.js';
import { createFakeInvestigator } from './fake.js';
import type { Investigator } from './types.js';

/**
 * AI when both AI_GATEWAY_API_KEY and REPRO_AI_MODEL are set, otherwise the offline fake.
 * Off by default: nothing leaves the machine unless an operator opts in with both variables.
 */
export function createInvestigatorFromEnv(env: NodeJS.ProcessEnv = process.env): Investigator {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  const model = env.REPRO_AI_MODEL?.trim();
  if (apiKey && model) return createAiInvestigator({ model, apiKey });
  return createFakeInvestigator();
}
