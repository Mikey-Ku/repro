import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EvidencePanel } from '@/components/session/EvidencePanel';
import { InvestigatePanel } from '@/components/session/InvestigatePanel';
import { PlayerProvider } from '@/components/session/PlayerContext';
import { ReplayPlayer } from '@/components/session/ReplayPlayer';
import { RunsPanel } from '@/components/session/RunsPanel';
import { SessionHeader } from '@/components/session/SessionHeader';
import { TestPanel } from '@/components/session/TestPanel';
import { TimelinePanel } from '@/components/session/TimelinePanel';
import { Badge, Card, EmptyState, Tabs } from '@/components/ui';
import { getSession, getTimeline, isNotFound, listRuns } from '@/lib/api';
import { shortId } from '@/lib/format';
import { requireProject } from '@/lib/project';
import type { TimelineResponse } from '@/lib/schemas';

type Props = {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ t?: string | string[]; tab?: string | string[]; v?: string | string[] }>;
};

const TABS = new Set(['timeline', 'evidence', 'test', 'runs', 'investigate']);

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Session ${shortId(id)}` };
}

/**
 * The centrepiece. Server component: it fetches everything the tabs need in
 * parallel and hands client components plain data. Player, timeline and seek
 * buttons talk to each other through PlayerProvider.
 */
export default async function SessionPage({ params, searchParams }: Props) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const project = await requireProject(slug);

  let detail;
  try {
    detail = await getSession(project.id, id);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  const { session, incidents, tests, findings } = detail;

  // The timeline is derived by the ingest service; a failure there should not hide the replay.
  let timeline: TimelineResponse | null = null;
  let timelineError: string | null = null;
  try {
    timeline = await getTimeline(project.id, id);
  } catch (error) {
    timelineError = error instanceof Error ? error.message : 'Timeline unavailable';
  }

  const requestedVersion = Number(one(query.v));
  const selectedTest = tests.find((test) => test.version === requestedVersion) ?? tests[0] ?? null;
  const runs = selectedTest ? await listRuns(project.id, selectedTest.id) : [];

  const t = Number(one(query.t));
  const initialOffsetMs = Number.isFinite(t) && t >= 0 ? Math.round(t) : null;
  const requestedTab = one(query.tab);
  const defaultTab = requestedTab && TABS.has(requestedTab) ? requestedTab : 'timeline';

  const firstErrorOffsetMs =
    timeline?.evidence.earliestError?.ref.offsetMs ??
    timeline?.entries.find((entry) => entry.kind === 'error' && entry.severity === 'error')?.offsetMs ??
    (incidents.length ? Math.min(...incidents.map((incident) => incident.offsetMs)) : null);

  const errorCount = timeline?.entries.filter((entry) => entry.kind === 'error').length ?? session.errorCount;
  const activeRuns = runs.filter((run) => run.status === 'queued' || run.status === 'running').length;

  const tabs = [
    {
      id: 'timeline',
      label: 'Timeline',
      badge: timeline ? <Badge>{timeline.entries.length}</Badge> : undefined,
      content: timeline ? <TimelinePanel entries={timeline.entries} /> : <TimelineUnavailable message={timelineError} />,
    },
    {
      id: 'evidence',
      label: 'Evidence',
      badge: errorCount > 0 ? <Badge tone="danger">{errorCount}</Badge> : undefined,
      content: timeline ? <EvidencePanel evidence={timeline.evidence} /> : <TimelineUnavailable message={timelineError} />,
    },
    {
      id: 'test',
      label: 'Test',
      badge: tests.length ? <Badge tone="success">v{selectedTest?.version}</Badge> : undefined,
      content: <TestPanel slug={slug} sessionId={id} tests={tests} selected={selectedTest} incidents={incidents} />,
    },
    {
      id: 'runs',
      label: 'Runs',
      badge: activeRuns ? <Badge tone="accent">{activeRuns} active</Badge> : runs.length ? <Badge>{runs.length}</Badge> : undefined,
      content: <RunsPanel slug={slug} sessionId={id} test={selectedTest} runs={runs} />,
    },
    {
      id: 'investigate',
      label: 'Investigate',
      badge: findings.some((finding) => finding.kind === 'investigation') ? <Badge tone="accent">done</Badge> : undefined,
      content: <InvestigatePanel slug={slug} sessionId={id} findings={findings} />,
    },
  ];

  return (
    <PlayerProvider initialOffsetMs={initialOffsetMs}>
      <SessionHeader slug={slug} session={session} firstErrorOffsetMs={firstErrorOffsetMs} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-2 lg:col-span-2">
          <ReplayPlayer
            slug={slug}
            sessionId={id}
            startedAtMs={new Date(session.startedAt).getTime()}
            viewport={{ width: session.viewportWidth, height: session.viewportHeight }}
          />
        </Card>
        <Card className="min-w-0 lg:col-span-1 lg:max-h-[calc(100vh-9rem)]" as="div">
          <Tabs tabs={tabs} defaultTab={defaultTab} label="Session details" className="h-full" />
        </Card>
      </div>
    </PlayerProvider>
  );
}

function TimelineUnavailable({ message }: { message: string | null }) {
  return <EmptyState compact title="Timeline unavailable" description={message ?? 'The ingest service could not build the timeline for this session.'} />;
}
