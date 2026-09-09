/**
 * Reproducible benchmarks for Repro. Prerequisites: Postgres, ingest, worker, demo and web
 * running (`pnpm dev`), Playwright Chromium installed, packages built (`pnpm build`).
 *
 *   pnpm bench                 run everything and write results/<timestamp>.json
 *   pnpm bench --only bundle,payload
 *   pnpm bench --write-docs    also rewrite the results section of docs/BENCHMARKS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { benchBundle } from './suites/bundle.js';
import { benchWorkflow } from './suites/workflow.js';
import { benchIngest } from './suites/ingest.js';
import { benchDashboard } from './suites/dashboard.js';
import { benchGenerator } from './suites/generator.js';
import { env, environmentDetails, repoRoot } from './env.js';
import { renderMarkdown, type BenchResults } from './report.js';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',') ?? null;
const writeDocs = args.includes('--write-docs');
const wants = (name: string) => !only || only.includes(name);

async function assertUp(url: string, label: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (error) {
    throw new Error(`${label} is not reachable at ${url} (${String(error)}). Start the stack with \`pnpm dev\` first.`);
  }
}

async function main(): Promise<void> {
  await assertUp(`${env.ingestUrl}/ready`, 'ingest');
  await assertUp(`${env.demoUrl}/__demo/health`, 'demo');
  if (wants('dashboard') || wants('generator')) await assertUp(`${env.webUrl}/api/health`, 'web');

  const results: BenchResults = { environment: environmentDetails(), suites: {} };

  if (wants('bundle')) results.suites.bundle = await benchBundle();
  if (wants('workflow') || wants('payload') || wants('redaction')) results.suites.workflow = await benchWorkflow();
  if (wants('ingest')) results.suites.ingest = await benchIngest(results.suites.workflow?.sampleBatch ?? null);
  if (wants('dashboard')) results.suites.dashboard = await benchDashboard(results.suites.workflow?.sessionId ?? null);
  if (wants('generator')) results.suites.generator = await benchGenerator();

  const outDir = path.join(repoRoot, 'scripts', 'bench', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(results, null, 2));

  const markdown = renderMarkdown(results);
  console.log(`\n${markdown}\n\nSaved ${path.relative(repoRoot, outFile)}`);

  if (writeDocs) {
    const docPath = path.join(repoRoot, 'docs', 'BENCHMARKS.md');
    const doc = fs.readFileSync(docPath, 'utf8');
    const start = '<!-- bench:start -->';
    const end = '<!-- bench:end -->';
    const a = doc.indexOf(start);
    const b = doc.indexOf(end);
    if (a === -1 || b === -1) throw new Error('docs/BENCHMARKS.md is missing the bench markers');
    fs.writeFileSync(docPath, `${doc.slice(0, a + start.length)}\n\n${markdown}\n\n${doc.slice(b)}`);
    console.log('Updated docs/BENCHMARKS.md');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
