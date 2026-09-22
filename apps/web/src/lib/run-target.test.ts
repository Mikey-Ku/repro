import { describe, expect, it } from 'vitest';
import { parseRunTargetChoice, runTargetChoices } from './run-target';

describe('runTargetChoices', () => {
  it('lists the demo modes first, then the external targets by name', () => {
    expect(runTargetChoices([])).toEqual([
      { value: 'demo:broken', label: 'Bundled demo (broken)' },
      { value: 'demo:fixed', label: 'Bundled demo (fixed)' },
    ]);
    expect(runTargetChoices([{ id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'external' }]).at(-1)).toEqual({ value: 'target:a1b2c3d4', label: 'Staging' });
  });
});

describe('parseRunTargetChoice', () => {
  it('turns a choice back into a run request and defaults to the broken demo', () => {
    expect(parseRunTargetChoice('demo:broken')).toEqual({ targetId: 'demo', mode: 'broken' });
    expect(parseRunTargetChoice('demo:fixed')).toEqual({ targetId: 'demo', mode: 'fixed' });
    expect(parseRunTargetChoice('target:a1b2c3d4')).toEqual({ targetId: 'a1b2c3d4' });
    expect(parseRunTargetChoice('target:')).toEqual({ targetId: 'demo', mode: 'broken' });
    expect(parseRunTargetChoice(null)).toEqual({ targetId: 'demo', mode: 'broken' });
    expect(parseRunTargetChoice('sideways')).toEqual({ targetId: 'demo', mode: 'broken' });
  });
});
