export interface BundleResult { rawBytes: number; gzipBytes: number; brotliBytes: number; esmRawBytes: number }
export interface WorkflowResult {
  runs: number;
  taskDurationMsWithSdk: number[];
  taskDurationMsWithoutSdk: number[];
  medianWithSdkMs: number;
  medianWithoutSdkMs: number;
  addedMainThreadMs: number;
  longTasksWithSdk: number;
  longTasksWithoutSdk: number;
  payload: { batches: number; compressedBytes: number; decompressedBytes: number; events: number; rrwebEvents: number; durationMs: number };
  redaction: { canaries: number; leaked: string[] };
  sessionId: string;
  sampleBatch: unknown;
}
export interface IngestResult { seconds: number; concurrency: number; requests: number; requestsPerSecond: number; eventsPerSecond: number; p50Ms: number; p95Ms: number; p99Ms: number; errors: number; batchEvents: number; batchBytes: number }
export interface DashboardResult { loads: number; sessionPageP50Ms: number; sessionPageP95Ms: number; replayReadyP50Ms: number; replayReadyP95Ms: number; timelineApiP50Ms: number; timelineApiP95Ms: number; listPageP50Ms: number; listPageP95Ms: number }
export interface GeneratorResult { fixtures: number; generated: number; passedFixed: number; failedBroken: number; details: { name: string; fixed: string; broken: string; failureMessage?: string }[] }

export interface BenchResults {
  environment: Record<string, string>;
  suites: {
    bundle?: BundleResult;
    workflow?: WorkflowResult;
    ingest?: IngestResult;
    dashboard?: DashboardResult;
    generator?: GeneratorResult;
  };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

export function renderMarkdown(r: BenchResults): string {
  const lines: string[] = [];
  lines.push('### Environment', '');
  for (const [k, v] of Object.entries(r.environment)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  const { bundle, workflow, ingest, dashboard, generator } = r.suites;
  lines.push('### Results', '', '| Metric | Value |', '| --- | --- |');
  if (bundle) {
    lines.push(`| SDK bundle (IIFE, minified) | ${kb(bundle.rawBytes)} raw, ${kb(bundle.gzipBytes)} gzip, ${kb(bundle.brotliBytes)} brotli |`);
    lines.push(`| SDK bundle (ESM, unminified) | ${kb(bundle.esmRawBytes)} raw |`);
  }
  if (workflow) {
    lines.push(`| Main-thread task time, demo workflow, median of ${workflow.runs} | ${workflow.medianWithSdkMs.toFixed(0)} ms with SDK, ${workflow.medianWithoutSdkMs.toFixed(0)} ms without, +${workflow.addedMainThreadMs.toFixed(0)} ms added |`);
    lines.push(`| Long tasks (>50 ms) during workflow | ${workflow.longTasksWithSdk} with SDK, ${workflow.longTasksWithoutSdk} without |`);
    lines.push(`| Recording payload, one demo session (${(workflow.payload.durationMs / 1000).toFixed(1)} s) | ${workflow.payload.batches} batches, ${kb(workflow.payload.compressedBytes)} on the wire, ${kb(workflow.payload.decompressedBytes)} decompressed, ${workflow.payload.events} events (${workflow.payload.rrwebEvents} rrweb) |`);
    lines.push(`| Redaction across the canary corpus | ${workflow.redaction.canaries - workflow.redaction.leaked.length}/${workflow.redaction.canaries} canaries absent from every outbound batch${workflow.redaction.leaked.length ? ` (leaked: ${workflow.redaction.leaked.join(', ')})` : ''} |`);
  }
  if (ingest) {
    lines.push(`| Ingestion throughput (${ingest.concurrency} concurrent clients, ${ingest.seconds} s, ${ingest.batchEvents} events and ${kb(ingest.batchBytes)} gzip per batch) | ${ingest.requestsPerSecond.toFixed(0)} batches/s, ${ingest.eventsPerSecond.toFixed(0)} events/s, ${ingest.errors} errors${ingest.errors ? ' (raise INGEST_RATE_LIMIT_PER_MINUTE and rerun)' : ''} |`);
    lines.push(`| Ingestion latency | p50 ${ingest.p50Ms.toFixed(1)} ms, p95 ${ingest.p95Ms.toFixed(1)} ms, p99 ${ingest.p99Ms.toFixed(1)} ms |`);
  }
  if (dashboard) {
    lines.push(`| Dashboard session page load (${dashboard.loads} loads) | p50 ${dashboard.sessionPageP50Ms.toFixed(0)} ms, p95 ${dashboard.sessionPageP95Ms.toFixed(0)} ms to DOM complete; p50 ${dashboard.replayReadyP50Ms.toFixed(0)} ms, p95 ${dashboard.replayReadyP95Ms.toFixed(0)} ms until replay is rendered |`);
    lines.push(`| Session list page load | p50 ${dashboard.listPageP50Ms.toFixed(0)} ms, p95 ${dashboard.listPageP95Ms.toFixed(0)} ms |`);
    lines.push(`| Timeline API (events decode + evidence) | p50 ${dashboard.timelineApiP50Ms.toFixed(1)} ms, p95 ${dashboard.timelineApiP95Ms.toFixed(1)} ms |`);
  }
  if (generator) {
    lines.push(`| Generated-test success across committed fixtures | ${generator.generated}/${generator.fixtures} generated, ${generator.passedFixed}/${generator.fixtures} pass in fixed mode, ${generator.failedBroken}/${generator.fixtures} fail in broken mode |`);
  }
  if (generator?.details.length) {
    lines.push('', '### Generator fixtures', '', '| Fixture | Fixed mode | Broken mode |', '| --- | --- | --- |');
    for (const d of generator.details) lines.push(`| ${d.name} | ${d.fixed} | ${d.broken} |`);
  }
  return lines.join('\n');
}
