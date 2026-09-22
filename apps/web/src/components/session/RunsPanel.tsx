import type { GeneratedTest, ReproductionRun, RunTarget } from '@repro/contracts';
import { RunPoller } from './RunPoller';
import { RunTargetSelect } from './RunTargetSelect';
import { IconDownload } from '@/components/icons';
import { Badge, Button, Disclosure, EmptyState, LinkButton, statusTone } from '@/components/ui';
import { createRunAction } from '@/lib/actions';
import { formatBytes, formatDateTime, formatDuration, shortId } from '@/lib/format';
import { apiPath } from '@/lib/paths';
import { DEMO_TARGET_LABEL } from '@/lib/run-target';

const ACTIVE = new Set(['queued', 'running']);

/**
 * Reproduction runs for the selected test version. Runs go through the job queue and execute
 * against the bundled demo app (in broken or fixed mode) or against one of the project's
 * external targets, which have no mode.
 */
export function RunsPanel({
  slug,
  sessionId,
  test,
  runs,
  targets,
}: {
  slug: string;
  sessionId: string;
  test: GeneratedTest | null;
  runs: ReproductionRun[];
  targets: RunTarget[];
}) {
  if (!test) {
    return <EmptyState compact title="No test to run" description="Generate a test first. Runs execute a generated test version against the demo application or one of the project's targets." />;
  }
  const action = createRunAction.bind(null, slug, sessionId, test.id);
  const active = runs.filter((run) => ACTIVE.has(run.status)).map((run) => run.id);

  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <RunTargetSelect targets={targets} disabled={active.length > 0} />
        <Button type="submit" variant="primary" disabled={active.length > 0}>
          Run
        </Button>
        <span className="text-muted">Test v{test.version}. On the demo: fails on broken, passes on fixed.</span>
      </form>
      <p className="text-2xs text-muted">
        Runs execute in a sandboxed Playwright process with a timeout, on the worker's machine. The bundled demo is switched into the chosen mode for the run; external targets (added
        under Settings) run as they are and must be reachable from the worker.
      </p>
      {active.length ? <RunPoller slug={slug} runIds={active} /> : null}

      {runs.length ? (
        <ol className="space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="rounded-md border border-border bg-raised/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                {run.target === 'demo' ? (
                  <>
                    <Badge tone={run.targetMode === 'fixed' ? 'success' : 'warning'}>{run.targetMode}</Badge>
                    <span className="text-muted">{DEMO_TARGET_LABEL}</span>
                  </>
                ) : (
                  <>
                    <Badge tone="accent">external</Badge>
                    <span className="text-text">{run.targetName ?? run.target}</span>
                    {run.targetUrl ? <span className="font-mono text-2xs text-muted">{run.targetUrl}</span> : null}
                  </>
                )}
                <span className="font-mono text-2xs text-muted">{shortId(run.id)}</span>
                <span className="text-muted">queued {formatDateTime(run.queuedAt)}</span>
                {run.durationMs !== null ? <span className="font-mono text-muted">{formatDuration(run.durationMs)}</span> : null}
                {run.exitCode !== null ? <span className="font-mono text-muted">exit {run.exitCode}</span> : null}
              </div>
              {run.failureMessage ? <pre className="mt-2 max-h-40 overflow-auto rounded border border-border bg-background px-2 py-1 text-2xs text-danger">{run.failureMessage}</pre> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {run.artifacts.map((artifact) =>
                  artifact.name === 'trace.zip' ? (
                    <LinkButton key={artifact.name} href={apiPath(slug, 'runs', run.id, 'artifacts', artifact.name)} download size="sm">
                      <IconDownload size={14} />
                      trace.zip ({formatBytes(artifact.bytes)})
                    </LinkButton>
                  ) : artifact.name === 'report.json' ? (
                    <LinkButton key={artifact.name} href={apiPath(slug, 'runs', run.id, 'artifacts', artifact.name)} external size="sm">
                      report.json ({formatBytes(artifact.bytes)})
                    </LinkButton>
                  ) : null,
                )}
              </div>
              {run.artifacts.some((artifact) => artifact.name === 'screenshot.png') ? (
                <Disclosure summary="Screenshot" className="mt-2">
                  {/* Plain img: the proxy streams the PNG and Next image optimisation adds nothing for a one-off capture. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={apiPath(slug, 'runs', run.id, 'artifacts', 'screenshot.png')} alt={`Final screenshot of run ${shortId(run.id)}`} className="max-h-96 rounded border border-border" />
                </Disclosure>
              ) : null}
              {run.logs ? (
                <Disclosure summary="Logs" className="mt-2">
                  <pre className="max-h-64 overflow-auto text-2xs text-muted">{run.logs}</pre>
                </Disclosure>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState compact title="No runs yet" description="Run the test against the broken demo to confirm it reproduces the bug, then against the fixed demo to confirm it passes. Pick an external target to try it against your own application." />
      )}
    </div>
  );
}
