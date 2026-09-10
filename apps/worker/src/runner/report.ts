/**
 * Read the JSON reporter output Playwright writes to report.json.
 * The shape is `JSONReport` from @playwright/test/reporter; only the fields used here are typed.
 */

interface ReportError {
  message?: string;
}

interface ReportResult {
  status?: string;
  duration?: number;
  error?: ReportError;
  errors?: ReportError[];
}

interface ReportTest {
  status?: 'skipped' | 'expected' | 'unexpected' | 'flaky';
  results?: ReportResult[];
}

interface ReportSpec {
  title?: string;
  ok?: boolean;
  tests?: ReportTest[];
}

interface ReportSuite {
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}

interface Report {
  suites?: ReportSuite[];
  errors?: ReportError[];
  stats?: { unexpected?: number; expected?: number; skipped?: number; duration?: number };
}

export interface ParsedReport {
  /** 'error' means the report carried no test at all (a compile error, an empty file). */
  outcome: 'passed' | 'failed' | 'error';
  failureMessage: string | null;
  /** Number of test cases the report contains. */
  tests: number;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Playwright colours its error messages; the dashboard wants plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function* walkSpecs(suites: readonly ReportSuite[] | undefined): Generator<ReportSpec> {
  for (const suite of suites ?? []) {
    yield* suite.specs ?? [];
    yield* walkSpecs(suite.suites);
  }
}

function firstMessage(errors: readonly ReportError[] | undefined): string | null {
  for (const error of errors ?? []) {
    const message = error.message?.trim();
    if (message) return stripAnsi(message).trim();
  }
  return null;
}

export function parseReport(input: unknown): ParsedReport {
  if (!input || typeof input !== 'object') {
    return { outcome: 'error', failureMessage: 'report.json is not a Playwright JSON report.', tests: 0 };
  }
  const report = input as Report;

  let tests = 0;
  let failed = false;
  let failureMessage: string | null = null;
  for (const spec of walkSpecs(report.suites)) {
    for (const test of spec.tests ?? []) {
      tests += 1;
      if (test.status === 'expected' || test.status === 'skipped') continue;
      // 'unexpected' and 'flaky' (retries are 0, so flaky cannot happen) both count as failure.
      failed = true;
      for (const result of test.results ?? []) {
        failureMessage ??= firstMessage(result.errors) ?? firstMessage(result.error ? [result.error] : undefined);
      }
      failureMessage ??= `Test "${spec.title ?? 'unnamed'}" did not pass.`;
    }
  }

  // Top-level errors are things like a TypeScript compile failure in the spec: nothing ran.
  const globalMessage = firstMessage(report.errors);
  if (tests === 0) {
    return {
      outcome: 'error',
      failureMessage: globalMessage ?? 'Playwright did not run any test.',
      tests: 0,
    };
  }
  if (globalMessage && !failed) {
    return { outcome: 'failed', failureMessage: globalMessage, tests };
  }
  return failed ? { outcome: 'failed', failureMessage, tests } : { outcome: 'passed', failureMessage: null, tests };
}
