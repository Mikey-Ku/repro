import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectArtifacts } from '../src/runner/artifacts.js';
import { truncateLogs, MAX_LOG_BYTES } from '../src/runner/run.js';
import { createWorkspace, removeWorkspace, PLAYWRIGHT_CONFIG } from '../src/runner/workspace.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'repro-worker-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('createWorkspace', () => {
  it('writes the fixed config and the spec, and removes any leftover', async () => {
    const root = path.join(tmp, 'workspace');
    const stale = path.join(root, 'run-1', 'report.json');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, '{}');

    const workspace = await createWorkspace(root, 'run-1', "import { test } from '@playwright/test';");
    expect(await fs.readFile(workspace.configPath, 'utf8')).toBe(PLAYWRIGHT_CONFIG);
    expect(await fs.readFile(workspace.specPath, 'utf8')).toContain('@playwright/test');
    await expect(fs.access(stale)).rejects.toThrow();

    await removeWorkspace(workspace);
    await expect(fs.access(workspace.dir)).rejects.toThrow();
  });

  it('pins the settings the runner relies on', () => {
    expect(PLAYWRIGHT_CONFIG).toContain("baseURL: process.env.REPRO_TARGET_URL");
    expect(PLAYWRIGHT_CONFIG).toContain("trace: 'on'");
    expect(PLAYWRIGHT_CONFIG).toContain('retries: 0');
    expect(PLAYWRIGHT_CONFIG).toContain('workers: 1');
    expect(PLAYWRIGHT_CONFIG).toContain("[['json', { outputFile: 'report.json' }]]");
  });
});

describe('collectArtifacts', () => {
  it('copies the first screenshot, the first trace and the report', async () => {
    const resultsDir = path.join(tmp, 'test-results');
    const runDir = path.join(resultsDir, 'repro-checkout-chromium');
    await fs.mkdir(path.join(runDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(runDir, 'test-failed-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(runDir, 'nested', 'zzz.png'), Buffer.from([0x00]));
    await fs.writeFile(path.join(runDir, 'trace.zip'), Buffer.from('PK'));
    const reportPath = path.join(tmp, 'report.json');
    await fs.writeFile(reportPath, '{"suites":[]}');

    const artifacts = await collectArtifacts({ artifactsRoot: path.join(tmp, 'artifacts'), runId: 'run-7', resultsDir, reportPath });
    expect(artifacts.map((a) => [a.name, a.contentType, a.bytes])).toEqual([
      ['screenshot.png', 'image/png', 4],
      ['trace.zip', 'application/zip', 2],
      ['report.json', 'application/json', 13],
    ]);
    for (const artifact of artifacts) {
      expect(path.isAbsolute(artifact.path)).toBe(true);
      expect(artifact.path.startsWith(path.join(tmp, 'artifacts', 'run-7'))).toBe(true);
      await expect(fs.access(artifact.path)).resolves.toBeUndefined();
    }
  });

  it('skips files that do not exist', async () => {
    const artifacts = await collectArtifacts({
      artifactsRoot: path.join(tmp, 'artifacts'),
      runId: 'run-8',
      resultsDir: path.join(tmp, 'missing'),
      reportPath: path.join(tmp, 'missing.json'),
    });
    expect(artifacts).toEqual([]);
  });
});

describe('truncateLogs', () => {
  it('joins stdout and stderr and returns null when both are empty', () => {
    expect(truncateLogs('', '  ')).toBeNull();
    expect(truncateLogs('out', 'err')).toBe('out\n\n--- stderr ---\nerr');
  });

  it('keeps the tail when the output is too long', () => {
    const logs = truncateLogs('a'.repeat(MAX_LOG_BYTES) + 'TAIL', '')!;
    expect(logs.startsWith('[... earlier output truncated')).toBe(true);
    expect(logs.endsWith('TAIL')).toBe(true);
    expect(Buffer.byteLength(logs)).toBeLessThan(MAX_LOG_BYTES + 100);
  });
});
