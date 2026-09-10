import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'timeline', label: 'Timeline', content: <p>Timeline panel</p> },
  { id: 'evidence', label: 'Evidence', content: <p>Evidence panel</p> },
  { id: 'test', label: 'Test', content: <p>Test panel</p> },
];

describe('Tabs', () => {
  it('renders WAI-ARIA tabs with only the selected tab in the tab order', () => {
    render(<Tabs tabs={tabs} label="Session details" />);
    const list = screen.getByRole('tablist', { name: 'Session details' });
    expect(list).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('tab');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Timeline panel');
  });

  it('respects defaultTab and falls back to the first tab for unknown ids', () => {
    const { unmount } = render(<Tabs tabs={tabs} defaultTab="evidence" label="A" />);
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    render(<Tabs tabs={tabs} defaultTab="nope" label="B" />);
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves selection and focus with arrow keys, wrapping at the ends, and jumps with Home and End', () => {
    render(<Tabs tabs={tabs} label="Session details" />);
    const [timeline, evidence, test] = screen.getAllByRole('tab');
    timeline!.focus();

    fireEvent.keyDown(timeline!, { key: 'ArrowRight' });
    expect(evidence).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(evidence);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Evidence panel');

    fireEvent.keyDown(evidence!, { key: 'ArrowLeft' });
    expect(timeline).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(timeline!, { key: 'ArrowLeft' });
    expect(test).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(test);

    fireEvent.keyDown(test!, { key: 'ArrowRight' });
    expect(timeline).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(timeline!, { key: 'End' });
    expect(test).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(test!, { key: 'Home' });
    expect(timeline).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click and keeps hidden panels mounted', () => {
    render(<Tabs tabs={tabs} label="Session details" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Test' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Test panel');
    // Hidden panels stay in the DOM so player and form state survives switching.
    expect(screen.getByText('Timeline panel')).not.toBeVisible();
  });
});
