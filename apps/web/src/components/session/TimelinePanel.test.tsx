import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelinePanel, groupOf } from './TimelinePanel';
import { XSS_IMG, XSS_SCRIPT, mockControls, timelineFixture, withControls } from '@/test/fixtures';

declare global {
  interface Window {
    __xss?: number;
  }
}

afterEach(() => {
  delete window.__xss;
});

describe('TimelinePanel', () => {
  it('renders one button per entry with the offset, title and detail', () => {
    render(withControls(mockControls(), <TimelinePanel entries={timelineFixture} />));
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(timelineFixture.length);
    const first = within(rows[0]!).getByRole('button');
    expect(first).toHaveTextContent('00:00.100');
    expect(first).toHaveTextContent('Navigated (load)');
    expect(first).toHaveTextContent('/checkout');
  });

  it('seeks the player with the row offset and seq when a row is activated', () => {
    const controls = mockControls();
    render(withControls(controls, <TimelinePanel entries={timelineFixture} />));
    fireEvent.click(screen.getByRole('button', { name: /console\.error/ }));
    expect(controls.seekTo).toHaveBeenCalledWith(2050, 4);
  });

  it('filters rows by kind through the chips', () => {
    render(withControls(mockControls(), <TimelinePanel entries={timelineFixture} />));
    const network = screen.getByRole('button', { name: /^Network/ });
    expect(network).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(network);
    expect(network).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /POST \/api\/orders/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(timelineFixture.length - 1);
  });

  it('puts stack traces in a collapsible pre', () => {
    render(withControls(mockControls(), <TimelinePanel entries={timelineFixture} />));
    const summary = screen.getByText('Stack trace');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details!.querySelector('pre')).toHaveTextContent('at submit (app.js:10:5)');
  });

  it('renders recorded values as text: no img or script elements, no side effects', () => {
    const { container } = render(withControls(mockControls(), <TimelinePanel entries={timelineFixture} />));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(window.__xss).toBeUndefined();
    // The attack strings survive verbatim as text content.
    expect(container.textContent).toContain(XSS_IMG);
    expect(container.textContent).toContain(XSS_SCRIPT);
  });

  it('groups application annotations with interactions', () => {
    expect(groupOf('annotation')).toBe('interaction');
    expect(groupOf('identify')).toBe('interaction');
    expect(groupOf('network')).toBe('network');
  });
});
