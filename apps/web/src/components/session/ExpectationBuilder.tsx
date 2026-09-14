'use client';

import { useActionState, useState } from 'react';
import type { Expectation, Incident } from '@repro/contracts';
import { IconClose } from '@/components/icons';
import { Button } from '@/components/ui';
import { generateTestAction, type ActionResult } from '@/lib/actions';
import { MAX_EXPECTATIONS, describeExpectation } from '@/lib/expectations';

/**
 * Builds the list of success expectations for a generated test and submits it
 * to the generate server action. The rows live in the parent (TestComposer) so
 * the suggestions block can add to them too; they are serialised into one hidden
 * JSON field and the action validates them against the contract.
 * `no-errors` is always added by the generator, so it is not offered here.
 */

export type ExpectationRow = { id: number; value: Expectation };
/** Only these two kinds are user-editable; `no-errors` is implicit. */
type Draft = Extract<Expectation, { kind: 'visible' | 'url' }>;

const control = 'h-7 min-w-0 rounded-md border border-border bg-raised px-2 text-xs text-text';

function isComplete(expectation: Expectation): boolean {
  if (expectation.kind === 'url') return expectation.pathPrefix.trim().length > 0;
  if (expectation.kind === 'visible') return Boolean(expectation.testId || expectation.role || expectation.text);
  return true;
}

export function ExpectationBuilder({
  slug,
  sessionId,
  incidents,
  rows,
  onAdd,
  onRemove,
  submitLabel = 'Generate Playwright test',
}: {
  slug: string;
  sessionId: string;
  incidents: Incident[];
  rows: ExpectationRow[];
  onAdd: (expectation: Expectation) => void;
  onRemove: (id: number) => void;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState<Draft>({ kind: 'visible', testId: '' });
  const [visibleBy, setVisibleBy] = useState<'testId' | 'role' | 'text'>('testId');
  const [result, formAction, pending] = useActionState<ActionResult | null, FormData>(generateTestAction.bind(null, slug, sessionId), null);

  const add = () => {
    if (!isComplete(draft) || rows.length >= MAX_EXPECTATIONS) return;
    onAdd(draft);
    setDraft(draft.kind === 'url' ? { kind: 'url', pathPrefix: '' } : { kind: 'visible', testId: '' });
  };

  const setDraftKind = (kind: 'visible' | 'url') => {
    setDraft(kind === 'url' ? { kind: 'url', pathPrefix: '' } : { kind: 'visible', testId: '' });
  };

  const setVisibleField = (field: 'testId' | 'role' | 'name' | 'text', value: string) => {
    setDraft((previous) => (previous.kind === 'visible' ? { ...previous, [field]: value } : previous));
  };

  return (
    <form action={formAction} className="space-y-3 text-xs">
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-2xs font-semibold tracking-wide text-muted uppercase">Success expectations</legend>
        <p className="text-muted">Assertions the fixed application must satisfy. "No uncaught errors" is always included.</p>

        {rows.length ? (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 rounded border border-border bg-raised px-2 py-1">
                <span className="truncate">{describeExpectation(row.value)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  aria-label={`Remove expectation: ${describeExpectation(row.value)}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-danger"
                >
                  <IconClose size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {rows.length < MAX_EXPECTATIONS ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-2xs text-muted">Kind</span>
              <select value={draft.kind} onChange={(event) => setDraftKind(event.target.value as 'visible' | 'url')} className={control}>
                <option value="visible">Element visible</option>
                <option value="url">URL path prefix</option>
              </select>
            </label>

            {draft.kind === 'visible' ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-2xs text-muted">Locate by</span>
                  <select
                    value={visibleBy}
                    onChange={(event) => {
                      setVisibleBy(event.target.value as typeof visibleBy);
                      setDraft({ kind: 'visible' });
                    }}
                    className={control}
                  >
                    <option value="testId">Test id</option>
                    <option value="role">Role and name</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                {visibleBy === 'testId' ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-2xs text-muted">Test id</span>
                    <input value={draft.testId ?? ''} onChange={(event) => setVisibleField('testId', event.target.value)} maxLength={200} placeholder="order-confirmation" className={control} />
                  </label>
                ) : null}
                {visibleBy === 'role' ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-2xs text-muted">Role</span>
                      <input value={draft.role ?? ''} onChange={(event) => setVisibleField('role', event.target.value)} maxLength={64} placeholder="heading" className={control} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-2xs text-muted">Name</span>
                      <input value={draft.name ?? ''} onChange={(event) => setVisibleField('name', event.target.value)} maxLength={200} placeholder="Thank you" className={control} />
                    </label>
                  </>
                ) : null}
                {visibleBy === 'text' ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-2xs text-muted">Text</span>
                    <input value={draft.text ?? ''} onChange={(event) => setVisibleField('text', event.target.value)} maxLength={200} placeholder="Order placed" className={control} />
                  </label>
                ) : null}
              </>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-muted">Path prefix</span>
                <input
                  value={draft.pathPrefix}
                  onChange={(event) => setDraft({ kind: 'url', pathPrefix: event.target.value })}
                  maxLength={500}
                  placeholder="/checkout/confirmation"
                  className={control}
                />
              </label>
            )}
            <Button size="sm" onClick={add} disabled={!isComplete(draft)}>
              Add
            </Button>
          </div>
        ) : (
          <p className="text-muted">Maximum of five expectations.</p>
        )}
      </fieldset>

      {/* A complete draft that was never explicitly added still counts: typing a test id and pressing
          Generate is the common path, and silently dropping it would be surprising. */}
      <input
        type="hidden"
        name="expectations"
        value={JSON.stringify([...rows.map((row) => row.value), ...(isComplete(draft) && rows.length < MAX_EXPECTATIONS ? [draft] : [])])}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-2xs text-muted">Test name (optional)</span>
          <input name="testName" maxLength={200} placeholder="checkout fails after placing order" className={control} />
        </label>
        {incidents.length ? (
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-muted">Incident</span>
            <select name="incidentId" defaultValue={incidents[0]?.id} className={control}>
              {incidents.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.title.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Generating' : submitLabel}
        </Button>
      </div>
      <p role="status" aria-live="polite" className={result && !result.ok ? 'text-danger' : 'sr-only'}>
        {result && !result.ok ? result.message : ''}
      </p>
    </form>
  );
}
