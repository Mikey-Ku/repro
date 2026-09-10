import type { DiagnosticFinding, Investigation } from '@repro/contracts';
import { RefButton } from './SeekButton';
import { Badge, Button, EmptyState, type BadgeTone } from '@/components/ui';
import { investigateAction } from '@/lib/actions';
import { formatDateTime } from '@/lib/format';

const CONFIDENCE_TONE: Record<Investigation['confidence'], BadgeTone> = {
  none: 'neutral',
  low: 'warning',
  medium: 'accent',
  high: 'success',
};

/**
 * Investigator output. Evidence (facts with refs) and inferences (reasoning)
 * are rendered in separate blocks and labelled, so a reader can always tell
 * what was observed from what was guessed.
 */
export function InvestigatePanel({ slug, sessionId, findings }: { slug: string; sessionId: string; findings: DiagnosticFinding[] }) {
  const action = investigateAction.bind(null, slug, sessionId);
  const investigations = findings.filter((finding) => finding.kind === 'investigation' && finding.investigation);

  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">
          Investigate
        </Button>
        <span className="text-muted">Runs the configured investigator over the evidence summary and stores a finding.</span>
      </form>

      {investigations.length ? (
        <ol className="space-y-3">
          {investigations.map((finding) => (
            <li key={finding.id}>
              <Finding finding={finding} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState compact title="No investigation yet" description="Press Investigate to produce a hypothesis from the captured evidence." />
      )}
    </div>
  );
}

function Finding({ finding }: { finding: DiagnosticFinding }) {
  const investigation = finding.investigation!;
  const fake = investigation.provider === 'fake' || investigation.provider === 'rules';
  return (
    <article className="space-y-2 rounded-md border border-border bg-raised/40 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={CONFIDENCE_TONE[investigation.confidence]}>confidence {investigation.confidence}</Badge>
        {investigation.abstained ? <Badge tone="warning">abstained</Badge> : null}
        <span className="text-muted">
          {investigation.provider}
          {investigation.model ? ` / ${investigation.model}` : ''}
        </span>
        <span className="ml-auto text-2xs text-muted">{formatDateTime(finding.createdAt)}</span>
      </header>

      {fake ? (
        <p className="rounded border border-border bg-background px-2 py-1 text-2xs text-muted">
          Deterministic rule-based investigator. Set AI_GATEWAY_API_KEY and REPRO_AI_MODEL to use a model.
        </p>
      ) : null}

      {investigation.abstained ? (
        <p className="text-text">
          The investigator abstained{investigation.abstainReason ? `: ${investigation.abstainReason}` : '.'}
        </p>
      ) : (
        <p className="text-sm text-text">{investigation.hypothesis ?? 'No hypothesis.'}</p>
      )}

      {investigation.evidence.length ? (
        <section>
          <h4 className="mb-1 text-2xs font-semibold tracking-wide text-muted uppercase">Evidence (observed)</h4>
          <ul className="space-y-1">
            {investigation.evidence.map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <RefButton evidenceRef={item.ref} />
                <span>{item.claim}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {investigation.inferences.length ? (
        <section>
          <h4 className="mb-1 text-2xs font-semibold tracking-wide text-muted uppercase">Inferences</h4>
          <ul className="space-y-1">
            {investigation.inferences.map((inference, index) => (
              <li key={index} className="flex items-start gap-2">
                <Badge tone="warning">Inference, not observed</Badge>
                <span>{inference}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {investigation.suggestedChecks.length ? (
        <section>
          <h4 className="mb-1 text-2xs font-semibold tracking-wide text-muted uppercase">Suggested checks</h4>
          <ol className="list-decimal space-y-1 pl-4">
            {investigation.suggestedChecks.map((check, index) => (
              <li key={index}>{check}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
