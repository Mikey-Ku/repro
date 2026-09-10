import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const MAX_BUFFER = 8 * 1024 * 1024;

export interface ExecuteOptions {
  workspaceDir: string;
  configPath: string;
  /** Base URL the spec runs against; becomes REPRO_TARGET_URL for the config. */
  targetUrl: string;
  timeoutMs: number;
  /** The parent environment; only an allowlist of it reaches the child. */
  parentEnv?: NodeJS.ProcessEnv;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  /** Null when the process was killed by a signal (including the timeout). */
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Locate Playwright's CLI entry so it can be run with the current node binary, without a shell.
 * `@playwright/test` exports `./cli`; older layouts expose `playwright/cli.js` instead.
 */
export function resolvePlaywrightCli(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve('@playwright/test/cli');
  } catch {
    try {
      return require.resolve('playwright/cli.js');
    } catch {
      throw new Error('Cannot find the Playwright CLI; is @playwright/test installed in apps/worker?');
    }
  }
}

/**
 * Only these variables reach the Playwright child. PATH and HOME are needed to find the browser
 * cache, CI=1 stops Playwright from opening reports, and REPRO_FIXTURE_* carries the values the
 * generated test substitutes for redacted inputs. Nothing else (database URL, tokens) leaks.
 */
export function childEnv(targetUrl: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: parent.PATH,
    HOME: parent.HOME,
    REPRO_TARGET_URL: targetUrl,
    CI: '1',
  };
  if (parent.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = parent.PLAYWRIGHT_BROWSERS_PATH;
  for (const [key, value] of Object.entries(parent)) {
    if (/^REPRO_FIXTURE_/.test(key) && value !== undefined) env[key] = value;
  }
  return env;
}

/** How long Playwright gets to stop its workers and browsers after SIGINT before SIGKILL. */
export const KILL_GRACE_MS = 5000;

/** SIGKILL the child's whole process group; falls back to the child alone when there is no group. */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Run `node <playwright cli> test --config <config>` inside the workspace with no shell.
 * Never throws for a failing test: a non-zero exit is a normal result.
 *
 * Timeout handling happens in two steps. Playwright forks its worker processes into their own
 * process groups, so a plain SIGKILL of the CLI would orphan a worker that keeps writing
 * screenshots into a workspace the runner is about to delete. SIGINT first lets the CLI stop
 * its workers and browsers the way Ctrl+C does; if it is still alive after KILL_GRACE_MS the
 * whole process group gets SIGKILL. The child starts detached so that group exists.
 */
export function executePlaywright(options: ExecuteOptions): Promise<ExecuteResult> {
  const cliPath = resolvePlaywrightCli();
  return new Promise((resolve) => {
    let timedOut = false;
    let hardKill: NodeJS.Timeout | undefined;
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [cliPath, 'test', '--config', options.configPath], {
      cwd: options.workspaceDir,
      env: childEnv(options.targetUrl, options.parentEnv),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (current: string, chunk: Buffer): string =>
      current.length >= MAX_BUFFER ? current : current + chunk.toString('utf8');
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGINT');
      } catch {
        // Already gone; the close event will fire.
      }
      hardKill = setTimeout(() => killTree(child.pid), KILL_GRACE_MS);
    }, options.timeoutMs);
    const finish = (exitCode: number | null, spawnError = ''): void => {
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      resolve({ stdout, stderr: spawnError + stderr, exitCode, timedOut });
    };
    child.once('error', (error: NodeJS.ErrnoException) => {
      // A spawn failure (for example ENOENT) never reaches 'close' with a code.
      finish(null, `${error.code ?? 'SPAWN_ERROR'}: ${error.message}\n`);
    });
    child.once('close', (code) => finish(code));
  });
}
