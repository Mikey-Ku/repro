import type { CreateRunRequest, RunTarget, RunTargetMode } from '@repro/contracts';

/**
 * The value of the Runs tab's target select. The demo has one entry per mode and every external
 * target has one entry; the server action turns the choice back into a CreateRunRequest.
 * Shared by the select (server component) and the action, and unit-tested on its own.
 */

export const DEMO_TARGET_LABEL = 'Bundled demo';

export interface RunTargetChoice {
  value: string;
  label: string;
}

export function demoChoice(mode: RunTargetMode): RunTargetChoice {
  return { value: `demo:${mode}`, label: `${DEMO_TARGET_LABEL} (${mode})` };
}

export function externalChoice(target: RunTarget): RunTargetChoice {
  return { value: `target:${target.id}`, label: target.name };
}

/** Demo broken, demo fixed, then each external target in the order the project lists them. */
export function runTargetChoices(targets: RunTarget[]): RunTargetChoice[] {
  return [demoChoice('broken'), demoChoice('fixed'), ...targets.map(externalChoice)];
}

/** Anything unexpected falls back to the demo in broken mode, the same default the API applies. */
export function parseRunTargetChoice(value: FormDataEntryValue | null): CreateRunRequest {
  if (typeof value !== 'string') return { targetId: 'demo', mode: 'broken' };
  if (value === 'demo:fixed') return { targetId: 'demo', mode: 'fixed' };
  if (value.startsWith('target:') && value.length > 'target:'.length) return { targetId: value.slice('target:'.length) };
  return { targetId: 'demo', mode: 'broken' };
}
