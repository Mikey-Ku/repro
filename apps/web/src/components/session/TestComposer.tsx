'use client';

import { useCallback, useRef, useState } from 'react';
import type { Expectation, Incident, ReferenceCandidate } from '@repro/contracts';
import { ExpectationBuilder, type ExpectationRow } from './ExpectationBuilder';
import { ExpectationSuggestions } from './ExpectationSuggestions';
import { MAX_EXPECTATIONS, sameExpectation } from '@/lib/expectations';

/**
 * Owns the expectation rows so both the suggestions block and the builder can add to them.
 * The builder still submits the generate action; this component only holds the shared list.
 */
export function TestComposer({
  slug,
  sessionId,
  incidents,
  candidates,
  submitLabel,
}: {
  slug: string;
  sessionId: string;
  incidents: Incident[];
  candidates: ReferenceCandidate[];
  submitLabel?: string;
}) {
  const [rows, setRows] = useState<ExpectationRow[]>([]);
  const nextId = useRef(1);

  const addRow = useCallback((value: Expectation) => {
    const id = nextId.current++;
    setRows((previous) => {
      if (previous.length >= MAX_EXPECTATIONS) return previous;
      if (previous.some((row) => sameExpectation(row.value, value))) return previous;
      return [...previous, { id, value }];
    });
  }, []);
  const removeRow = useCallback((id: number) => setRows((previous) => previous.filter((row) => row.id !== id)), []);

  return (
    <div className="space-y-3">
      <ExpectationSuggestions
        slug={slug}
        sessionId={sessionId}
        candidates={candidates}
        added={rows.map((row) => row.value)}
        limitReached={rows.length >= MAX_EXPECTATIONS}
        onAdd={addRow}
      />
      <ExpectationBuilder slug={slug} sessionId={sessionId} incidents={incidents} rows={rows} onAdd={addRow} onRemove={removeRow} submitLabel={submitLabel} />
    </div>
  );
}
