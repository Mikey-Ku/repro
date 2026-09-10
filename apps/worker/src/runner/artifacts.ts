import fs from 'node:fs/promises';
import path from 'node:path';

export interface Artifact {
  name: string;
  contentType: string;
  bytes: number;
  /** Absolute path on the worker's disk. The ingest API streams the file from here. */
  path: string;
}

/**
 * Every file under `dir`, files of a directory before its subdirectories, each level sorted by
 * name, so "the first screenshot" is deterministic and a top-level one wins over a nested one.
 */
export async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...(await listFiles(path.join(dir, entry.name))));
  }
  return files;
}

async function copyArtifact(source: string, target: string, name: string, contentType: string): Promise<Artifact> {
  await fs.copyFile(source, target);
  const { size } = await fs.stat(target);
  return { name, contentType, bytes: size, path: target };
}

/**
 * Copy what the dashboard shows into `${artifactsRoot}/<runId>/`: the first screenshot and the
 * first trace found under test-results, plus the JSON report. Missing files are simply skipped
 * (a passing run has no screenshot, a run that never started has no trace).
 */
export async function collectArtifacts(input: {
  artifactsRoot: string;
  runId: string;
  resultsDir: string;
  reportPath: string;
}): Promise<Artifact[]> {
  const target = path.join(input.artifactsRoot, input.runId);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });

  const files = await listFiles(input.resultsDir);
  const screenshot = files.find((file) => file.endsWith('.png'));
  const trace = files.find((file) => path.basename(file) === 'trace.zip');

  const artifacts: Artifact[] = [];
  if (screenshot) artifacts.push(await copyArtifact(screenshot, path.join(target, 'screenshot.png'), 'screenshot.png', 'image/png'));
  if (trace) artifacts.push(await copyArtifact(trace, path.join(target, 'trace.zip'), 'trace.zip', 'application/zip'));
  try {
    await fs.access(input.reportPath);
    artifacts.push(await copyArtifact(input.reportPath, path.join(target, 'report.json'), 'report.json', 'application/json'));
  } catch {
    // No report: Playwright crashed before writing one. The logs explain why.
  }
  return artifacts;
}
