import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidencePanel } from './EvidencePanel';
import { XSS_IMG, XSS_SCRIPT, evidenceFixture, mockControls, withControls } from '@/test/fixtures';

declare global {
  interface Window {
    __xss?: number;
  }
}

afterEach(() => {
  delete window.__xss;
});

describe('EvidencePanel', () => {
  it('renders the gaps under "What the evidence does not show"', () => {
    render(withControls(mockControls(), <EvidencePanel evidence={evidenceFixture} />));
    const heading = screen.getByRole('heading', { name: /What the evidence does not show/ });
    const section = heading.closest('section')!;
    for (const gap of evidenceFixture.gaps) expect(section).toHaveTextContent(gap);
  });

  it('says so when there are no gaps and no error', () => {
    render(withControls(mockControls(), <EvidencePanel evidence={{ ...evidenceFixture, gaps: [], earliestError: null }} />));
    expect(screen.getByText('No gaps were reported.')).toBeInTheDocument();
    expect(screen.getByText('No error was captured.')).toBeInTheDocument();
  });

  it('turns every ref into a seek button', () => {
    const controls = mockControls();
    render(withControls(controls, <EvidencePanel evidence={evidenceFixture} />));
    const buttons = screen.getAllByRole('button', { name: /^@ / });
    // earliestError + requestsBeforeError + failed + slow + lastActions + consoleErrors
    expect(buttons).toHaveLength(6);
    fireEvent.click(buttons[0]!);
    expect(controls.seekTo).toHaveBeenCalledWith(2100, 5);
  });

  it('renders stats', () => {
    render(withControls(mockControls(), <EvidencePanel evidence={evidenceFixture} />));
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('2.5 s')).toBeInTheDocument();
  });

  it('renders attack-shaped strings as inert text', () => {
    const { container } = render(withControls(mockControls(), <EvidencePanel evidence={evidenceFixture} />));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(window.__xss).toBeUndefined();
    expect(container.textContent).toContain(XSS_IMG);
    expect(container.textContent).toContain(XSS_SCRIPT);
  });
});
