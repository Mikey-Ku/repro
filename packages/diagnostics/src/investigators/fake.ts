import type { EvidenceSummary, Investigation } from '@repro/contracts';
import type { Investigator, InvestigatorInput } from './types.js';

export const FAKE_PROVIDER = 'fake';
export const FAKE_MODEL = 'rules-v1';

type Evidence = Investigation['evidence'];

const base = (): Pick<Investigation, 'provider' | 'model'> => ({ provider: FAKE_PROVIDER, model: FAKE_MODEL });

function abstain(reason: string, evidence: Evidence = []): Investigation {
  return {
    ...base(),
    hypothesis: null,
    confidence: 'none',
    abstained: true,
    abstainReason: reason,
    evidence,
    inferences: [],
    suggestedChecks: [],
  };
}

function lastActionEvidence(summary: EvidenceSummary): Evidence {
  const last = summary.lastActions[summary.lastActions.length - 1];
  return last ? [{ claim: `The last user action before the error was: ${last.description}.`, ref: last.ref }] : [];
}

/**
 * Offline investigator. It applies a handful of readable rules to the evidence summary and
 * never invents a fact: every evidence entry points at a ref from the summary.
 */
export function createFakeInvestigator(): Investigator {
  return {
    provider: FAKE_PROVIDER,
    model: FAKE_MODEL,
    async investigate({ summary }: InvestigatorInput): Promise<Investigation> {
      const error = summary.earliestError;
      if (!error) {
        const failed = summary.failedRequests.map((r) => ({
          claim: `${r.method} ${r.path} failed with ${r.status ?? r.error ?? 'a network error'}.`,
          ref: r.ref,
        }));
        return abstain('No error was recorded in this session, so there is nothing to explain.', failed);
      }

      const errorEvidence = {
        claim: `${error.name ?? 'Error'} was thrown ${error.ref.offsetMs} ms into the session: ${error.message}`,
        ref: error.ref,
      };
      const nullish = /\b(undefined|null)\b/i.test(error.message);
      const before = summary.requestsBeforeError;
      const lastOk = [...before].reverse().find((r) => r.ok);
      const lastFailed = [...before].reverse().find((r) => !r.ok);

      // Rule 1: a successful request right before a "reading undefined" TypeError usually means
      // the page expected a field the API did not return.
      if (error.name === 'TypeError' && nullish && lastOk) {
        const where = `${lastOk.method} ${lastOk.path}`;
        return {
          ...base(),
          hypothesis: `The response from ${where} succeeded, but the page code read a property that is not in the response shape.`,
          confidence: 'medium',
          abstained: false,
          evidence: [
            { claim: `${where} completed with status ${lastOk.status} shortly before the error.`, ref: lastOk.ref },
            errorEvidence,
            ...lastActionEvidence(summary),
          ],
          inferences: [
            `A TypeError mentioning ${nullish ? 'undefined or null' : 'a missing value'} means code dereferenced something that was not there.`,
            `The only request that completed in the 5 s before the error was ${where}, and it succeeded, so the missing value most likely comes from that response rather than from a failed call.`,
            'The evidence shows the timing, not the field name; confirming it requires comparing the response body with the code that consumes it.',
          ],
          suggestedChecks: [
            `Compare the JSON returned by ${where} in this release with the fields the page reads right after the request resolves.`,
            'Open the stack trace and check which property access sits on the failing line.',
            `Reproduce by replaying the recorded actions against the same route (${summary.route ?? 'unknown'}) and inspecting the response in devtools.`,
          ],
        };
      }

      // Rule 2: a failed request right before the error points at unhandled failure handling.
      if (lastFailed) {
        const where = `${lastFailed.method} ${lastFailed.path}`;
        const outcome = lastFailed.status ?? 'a network error';
        return {
          ...base(),
          hypothesis: `${where} returned ${outcome} shortly before the error, and the page did not handle the failed response.`,
          confidence: 'medium',
          abstained: false,
          evidence: [
            { claim: `${where} failed with ${outcome} within 5 s before the error.`, ref: lastFailed.ref },
            errorEvidence,
            ...lastActionEvidence(summary),
          ],
          inferences: [
            'A failed request immediately followed by an uncaught error is the usual shape of missing error handling on the response path.',
            'The order of events shows correlation, not causation; the failing line in the stack trace decides it.',
          ],
          suggestedChecks: [
            `Check the server logs for ${where} around ${new Date(lastFailed.ref.ts).toISOString()}.`,
            'Verify that the code awaiting this request checks response.ok before reading the body.',
          ],
        };
      }

      // Rule 3: the error has no nearby request, so the trigger is most likely the last action itself.
      const lastAction = summary.lastActions[summary.lastActions.length - 1];
      if (lastAction) {
        return {
          ...base(),
          hypothesis: `The error was triggered directly by the last user action (${lastAction.description}) without any network request in between.`,
          confidence: 'low',
          abstained: false,
          evidence: [errorEvidence, ...lastActionEvidence(summary)],
          inferences: [
            'No request completed in the 5 s before the error, so the failure is likely in client-side code that runs on the interaction.',
          ],
          suggestedChecks: [
            'Look at the event handler bound to the control in the last action and at the stack trace for the failing frame.',
            'Reproduce with the generated Playwright test and watch the console at the moment of that action.',
          ],
        };
      }

      return abstain('An error was recorded but no user action or request precedes it, so the evidence does not support a hypothesis.', [errorEvidence]);
    },
  };
}
