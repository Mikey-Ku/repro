import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpectationSuggestion, ReferenceCandidate } from '@repro/contracts';
import { ExpectationSuggestions, NO_CANDIDATES_TEXT, NO_DIFFERENCES_TEXT } from './ExpectationSuggestions';
import { XSS_IMG } from '@/test/fixtures';

const candidates: ReferenceCandidate[] = [
  { id: '11111111-1111-4111-8111-111111111111', startedAt: '2026-09-14T10:00:00.000Z', release: 'v1.2.0', browserName: 'Chrome', durationMs: 4200, errorCount: 0 },
  { id: '22222222-2222-4222-8222-222222222222', startedAt: '2026-09-13T09:30:00.000Z', release: null, browserName: 'Firefox', durationMs: 65_000, errorCount: 0 },
];

const suggestions: ExpectationSuggestion[] = [
  { expectation: { kind: 'visible', testId: 'order-confirmation' }, source: 'reference-session', reason: 'Appears in the passing session but never in this one' },
  { expectation: { kind: 'visible', text: XSS_IMG }, source: 'reference-session', reason: 'Appears in the passing session but never in this one' },
  { expectation: { kind: 'url', pathPrefix: '/checkout/confirmation' }, source: 'reference-session', reason: 'The passing session ended on this path' },
];

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExpectationSuggestions', () => {
  it('explains how to get suggestions when there is no passing session to compare with', () => {
    render(<ExpectationSuggestions slug="shop" sessionId="s1" candidates={[]} added={[]} limitReached={false} onAdd={vi.fn()} />);
    expect(screen.getByText(NO_CANDIDATES_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull();
  });

  it('labels each candidate by start time, release and duration', () => {
    render(<ExpectationSuggestions slug="shop" sessionId="s1" candidates={candidates} added={[]} limitReached={false} onAdd={vi.fn()} />);
    const select = screen.getByLabelText('Passing session');
    const labels = Array.from((select as HTMLSelectElement).options).map((option) => option.textContent);
    expect(labels).toEqual(['started 14 Sept 2026, 10:00:00 UTC, v1.2.0, 4.2 s', 'started 13 Sept 2026, 09:30:00 UTC, no release, 1m 05s']);
  });

  it('fetches suggestions for the chosen reference through the proxy and lists them with reasons', async () => {
    const fetchMock = mockFetch({ suggestions, reference: candidates[1]!.id });
    const onAdd = vi.fn();
    render(<ExpectationSuggestions slug="my shop" sessionId="s1" candidates={candidates} added={[]} limitReached={false} onAdd={onAdd} />);

    fireEvent.change(screen.getByLabelText('Passing session'), { target: { value: candidates[1]!.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));

    const list = await screen.findByRole('list', { name: 'Suggested expectations' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/projects/my%20shop/sessions/s1/expectation-suggestions?reference=${candidates[1]!.id}`);
    expect(list).toHaveTextContent('Visible: test id "order-confirmation"');
    expect(list).toHaveTextContent('URL starts with /checkout/confirmation');
    expect(list).toHaveTextContent('The passing session ended on this path');
    expect(screen.getByRole('status')).toHaveTextContent('3 suggestions from the passing session.');

    // Recorded text renders as text, never as markup.
    expect(list.querySelector('img')).toBeNull();
    expect(list.textContent).toContain(XSS_IMG);

    fireEvent.click(screen.getByRole('button', { name: 'Add: URL starts with /checkout/confirmation' }));
    expect(onAdd).toHaveBeenCalledWith({ kind: 'url', pathPrefix: '/checkout/confirmation' });
  });

  it('marks suggestions that are already in the builder and stops at the limit', async () => {
    mockFetch({ suggestions, reference: candidates[0]!.id });
    const { rerender } = render(
      <ExpectationSuggestions slug="shop" sessionId="s1" candidates={candidates} added={[{ kind: 'visible', testId: 'order-confirmation' }]} limitReached={false} onAdd={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    const added = await screen.findByRole('button', { name: 'Added: Visible: test id "order-confirmation"' });
    expect(added).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add: URL starts with /checkout/confirmation' })).toBeEnabled();

    rerender(<ExpectationSuggestions slug="shop" sessionId="s1" candidates={candidates} added={[{ kind: 'visible', testId: 'order-confirmation' }]} limitReached onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add: URL starts with /checkout/confirmation' })).toBeDisabled();
    expect(screen.getByText(/Maximum of five expectations reached/)).toBeInTheDocument();
  });

  it('says so when the passing session shows nothing this one does not', async () => {
    mockFetch({ suggestions: [], reference: candidates[0]!.id });
    render(<ExpectationSuggestions slug="shop" sessionId="s1" candidates={candidates} added={[]} limitReached={false} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(NO_DIFFERENCES_TEXT));
    expect(screen.queryByRole('list', { name: 'Suggested expectations' })).toBeNull();
  });

  it('surfaces API errors in the live region', async () => {
    mockFetch({ ok: false, error: { code: 'not_found', message: 'Reference session not found' } }, 404);
    render(<ExpectationSuggestions slug="shop" sessionId="s1" candidates={candidates} added={[]} limitReached={false} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reference session not found'));
  });
});
