import type { IncidentGroup } from '@repro/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncidentGroupTable } from './IncidentGroupTable';

const group = (overrides: Partial<IncidentGroup> = {}): IncidentGroup => ({
  fingerprint: 'fp-shared',
  kind: 'exception',
  title: 'TypeError: Cannot read properties of undefined',
  message: 'Cannot read properties of undefined',
  sessionCount: 10,
  firstSeen: '2026-09-01T10:00:00.000Z',
  lastSeen: '2026-09-09T18:30:00.000Z',
  releases: ['v1.0.0', 'v1.1.0'],
  routes: ['/cart', '/checkout'],
  openCount: 7,
  latestIncidentId: 'incident-latest',
  latestSessionId: 'session-latest',
  ...overrides,
});

describe('IncidentGroupTable', () => {
  it('renders one row per group that links to the latest incident', () => {
    render(<IncidentGroupTable slug="demo" groups={[group()]} />);
    const link = screen.getByRole('link', { name: 'TypeError: Cannot read properties of undefined' });
    expect(link).toHaveAttribute('href', '/projects/demo/incidents/incident-latest');

    const row = link.closest('tr')!;
    expect(within(row).getByText('exception')).toBeInTheDocument();
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('7 / 10')).toBeInTheDocument();
    expect(within(row).getByTitle('v1.0.0, v1.1.0')).toHaveTextContent('v1.0.0, v1.1.0');
    expect(within(row).getByTitle('/cart, /checkout')).toHaveTextContent('/cart, /checkout');
    // Absolute timestamps sit in the title so hover reveals them; the cell shows relative time.
    expect(within(row).getByTitle('01 Sept 2026, 10:00:00 UTC')).toBeInTheDocument();
    expect(within(row).getByTitle('09 Sept 2026, 18:30:00 UTC')).toBeInTheDocument();
  });

  it('shows n/a for groups without releases or routes and marks fully resolved groups', () => {
    render(<IncidentGroupTable slug="demo" groups={[group({ releases: [], routes: [], openCount: 0, sessionCount: 3 })]} />);
    expect(screen.getAllByText('n/a')).toHaveLength(2);
    expect(screen.getByText('0 / 3')).toBeInTheDocument();
  });
});
