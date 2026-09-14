'use client';

import { useId, useState } from 'react';
import { ExpectationSuggestionsResponseSchema, type Expectation, type ExpectationSuggestion, type ReferenceCandidate } from '@repro/contracts';
import { Button } from '@/components/ui';
import { describeExpectation, sameExpectation } from '@/lib/expectations';
import { formatDateTime, formatDuration } from '@/lib/format';
import { apiPath } from '@/lib/paths';

/**
 * "Suggest from a passing session": pick a completed, error-free session on the same route,
 * ask the API what it showed that this session never did, and add any of those as expectations.
 * The list is fetched through the route handler proxy so the internal token stays on the server.
 */

const control = 'h-7 min-w-0 rounded-md border border-border bg-raised px-2 text-xs text-text';

export const NO_CANDIDATES_TEXT = 'Record a passing session on this route to get suggestions.';
export const NO_DIFFERENCES_TEXT = 'No differences: the passing session shows the same test ids, status texts, headings and final path as this one.';

export function candidateLabel(candidate: ReferenceCandidate): string {
  return `started ${formatDateTime(candidate.startedAt)}, ${candidate.release ?? 'no release'}, ${formatDuration(candidate.durationMs)}`;
}

type Fetched = { suggestions: ExpectationSuggestion[]; note?: string };

export function ExpectationSuggestions({
  slug,
  sessionId,
  candidates,
  added,
  limitReached,
  onAdd,
}: {
  slug: string;
  sessionId: string;
  candidates: ReferenceCandidate[];
  /** Expectations already in the builder, so a suggestion can show as added rather than be added twice. */
  added: Expectation[];
  /** True when the builder holds the maximum number of expectations. */
  limitReached: boolean;
  onAdd: (expectation: Expectation) => void;
}) {
  const selectId = useId();
  const [reference, setReference] = useState(candidates[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);

  const suggest = async () => {
    if (!reference) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${apiPath(slug, 'sessions', sessionId, 'expectation-suggestions')}?reference=${encodeURIComponent(reference)}`, { cache: 'no-store' });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (json as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(message ?? `${response.status} ${response.statusText}`);
      }
      const parsed = ExpectationSuggestionsResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error('Unexpected response from the suggestions endpoint.');
      setFetched({ suggestions: parsed.data.suggestions, note: parsed.data.note });
    } catch (caught) {
      setFetched(null);
      setError(caught instanceof Error ? caught.message : 'Could not load suggestions.');
    } finally {
      setPending(false);
    }
  };

  const summary = error
    ? error
    : fetched
      ? fetched.suggestions.length
        ? `${fetched.suggestions.length} suggestion${fetched.suggestions.length === 1 ? '' : 's'} from the passing session.`
        : (fetched.note ?? NO_DIFFERENCES_TEXT)
      : '';

  return (
    <section aria-labelledby={`${selectId}-heading`} className="space-y-2 rounded-md border border-border p-3 text-xs">
      <h3 id={`${selectId}-heading`} className="text-2xs font-semibold tracking-wide text-muted uppercase">
        Suggest from a passing session
      </h3>
      <p className="text-muted">Compare this recording with one that reached the success state on the same route. Whatever appeared only there is proposed as an expectation.</p>

      {candidates.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={selectId} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-2xs text-muted">Passing session</span>
            <select id={selectId} value={reference} onChange={(event) => setReference(event.target.value)} className={control} disabled={pending}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidateLabel(candidate)}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" onClick={suggest} disabled={pending || !reference} aria-busy={pending}>
            {pending ? 'Suggesting' : 'Suggest'}
          </Button>
        </div>
      ) : (
        <p className="text-muted">{NO_CANDIDATES_TEXT}</p>
      )}

      <p role="status" aria-live="polite" className={error ? 'text-danger' : fetched && !fetched.suggestions.length ? 'text-muted' : 'sr-only'}>
        {summary}
      </p>

      {fetched && fetched.suggestions.length ? (
        <ul aria-label="Suggested expectations" className="space-y-1">
          {fetched.suggestions.map((suggestion, index) => {
            const text = describeExpectation(suggestion.expectation);
            const isAdded = added.some((value) => sameExpectation(value, suggestion.expectation));
            return (
              <li key={`${index}-${text}`} className="flex items-center justify-between gap-2 rounded border border-border bg-raised px-2 py-1">
                <div className="min-w-0">
                  <p className="truncate text-text" title={text}>
                    {text}
                  </p>
                  <p className="text-2xs text-muted">{suggestion.reason}</p>
                </div>
                <Button size="sm" onClick={() => onAdd(suggestion.expectation)} disabled={isAdded || limitReached} aria-label={`${isAdded ? 'Added' : 'Add'}: ${text}`}>
                  {isAdded ? 'Added' : 'Add'}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {fetched && fetched.suggestions.length && limitReached ? <p className="text-muted">Maximum of five expectations reached; remove one to add another.</p> : null}
    </section>
  );
}
