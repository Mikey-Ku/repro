import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunTarget } from '@repro/contracts';
import { RunTargetSelect } from './RunTargetSelect';

const targets: RunTarget[] = [
  { id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'external' },
  { id: 'e5f6a7b8', name: '<b>Local dev</b>', url: 'http://localhost:5173', kind: 'external' },
];

describe('RunTargetSelect', () => {
  it('offers the demo in both modes and nothing else when the project has no targets', () => {
    render(<RunTargetSelect targets={[]} />);
    const select = screen.getByLabelText('Target') as HTMLSelectElement;
    expect(select.name).toBe('target');
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ['demo:broken', 'Bundled demo (broken)'],
      ['demo:fixed', 'Bundled demo (fixed)'],
    ]);
    expect(select.value).toBe('demo:broken');
  });

  it('adds one option per external target, labelled by name and rendered as text', () => {
    render(<RunTargetSelect targets={targets} />);
    const select = screen.getByLabelText('Target') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['demo:broken', 'demo:fixed', 'target:a1b2c3d4', 'target:e5f6a7b8']);
    expect(screen.getByRole('option', { name: 'Staging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '<b>Local dev</b>' })).toBeInTheDocument();
    expect(select.querySelector('b')).toBeNull();
  });

  it('is disabled while a run is active', () => {
    render(<RunTargetSelect targets={targets} disabled />);
    expect(screen.getByLabelText('Target')).toBeDisabled();
  });
});
