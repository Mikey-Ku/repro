import type { GeneratedTest, Incident } from '@repro/contracts';
import { ExpectationBuilder } from './ExpectationBuilder';
import { VersionSelect } from './VersionSelect';
import { CopyButton } from '@/components/CopyButton';
import { IconDownload } from '@/components/icons';
import { Badge, Disclosure, EmptyState, LinkButton, type BadgeTone } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { highlightTypescript } from '@/lib/highlight';
import { apiPath } from '@/lib/paths';

const STRATEGY_TONE: Record<GeneratedTest['selectors'][number]['strategy'], BadgeTone> = {
  testid: 'success',
  role: 'success',
  label: 'accent',
  placeholder: 'accent',
  attribute: 'warning',
  css: 'warning',
  none: 'danger',
};

/**
 * Server component: highlighting happens here with shiki, so the browser gets
 * finished HTML and no grammar bundle. Shiki escapes the code before wrapping
 * it in spans, which is why dangerouslySetInnerHTML is acceptable for it.
 */
export async function TestPanel({ slug, sessionId, tests, selected, incidents }: { slug: string; sessionId: string; tests: GeneratedTest[]; selected: GeneratedTest | null; incidents: Incident[] }) {
  if (!selected) {
    return (
      <div className="px-3 py-3">
        <EmptyState
          compact
          title="No test generated yet"
          description="The generator turns the recorded actions into a Playwright test deterministically: same session, same file. Add expectations for the fixed state, then generate."
        />
        <ExpectationBuilder slug={slug} sessionId={sessionId} incidents={incidents} />
      </div>
    );
  }

  const html = await highlightTypescript(selected.code);
  const versions = tests.map((test) => test.version).sort((a, b) => b - a);

  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text" title={selected.name}>
            {selected.name}
          </p>
          <p className="text-2xs text-muted">
            Generated {formatDateTime(selected.createdAt)} by generator {selected.generatorVersion}, source hash <span className="font-mono">{selected.sourceHash.slice(0, 12)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 ? <VersionSelect versions={versions} selected={selected.version} /> : <Badge>v{selected.version}</Badge>}
          <CopyButton text={selected.code} label="Copy test code" />
          <LinkButton href={apiPath(slug, 'tests', selected.id, 'code')} download size="sm">
            <IconDownload size={14} />
            Download
          </LinkButton>
        </div>
      </div>

      {selected.warnings.length ? (
        <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning" aria-label="Warnings">
          {selected.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="code-block overflow-hidden rounded-md border border-border" dangerouslySetInnerHTML={{ __html: html }} />

      <Disclosure summary={`Selectors (${selected.selectors.length})`}>
        {selected.selectors.length ? (
          <ul className="space-y-1">
            {selected.selectors.map((entry) => (
              <li key={`${entry.seq}-${entry.action}`} className="flex flex-wrap items-center gap-2">
                <span className="w-10 font-mono text-2xs text-muted">#{entry.seq}</span>
                <span className="text-text">{entry.action}</span>
                <Badge tone={STRATEGY_TONE[entry.strategy]}>{entry.strategy}</Badge>
                <code className="min-w-0 truncate rounded bg-raised px-1 text-2xs" title={entry.selector}>
                  {entry.selector}
                </code>
                {entry.note ? <span className="text-muted">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No element selectors were needed.</p>
        )}
      </Disclosure>

      <Disclosure summary={`Omitted events (${selected.omitted.length})`}>
        {selected.omitted.length ? (
          <ul className="space-y-1">
            {selected.omitted.map((entry) => (
              <li key={`${entry.seq}-${entry.type}`} className="flex flex-wrap items-center gap-2">
                <span className="w-10 font-mono text-2xs text-muted">#{entry.seq}</span>
                <Badge>{entry.type}</Badge>
                <span className="text-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Every recorded action made it into the test.</p>
        )}
      </Disclosure>

      <Disclosure summary="Expectations used">
        <ul className="space-y-1">
          <li>No uncaught errors (always)</li>
          {selected.expectations.map((expectation, index) => (
            <li key={index} className="font-mono">
              {JSON.stringify(expectation)}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure summary="Regenerate with different expectations">
        <p className="mb-2 text-muted">Creates version {Math.max(...versions) + 1} unless the input is identical to the latest version, in which case the latest is returned unchanged.</p>
        <ExpectationBuilder slug={slug} sessionId={sessionId} incidents={incidents} submitLabel="Regenerate" />
      </Disclosure>
    </div>
  );
}
