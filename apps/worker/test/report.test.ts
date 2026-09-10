import { describe, expect, it } from 'vitest';
import { parseReport, stripAnsi } from '../src/runner/report.js';

/** Minimal builder for the Playwright JSON reporter shape (JSONReport in @playwright/test/reporter). */
function report(input: {
  tests?: { title: string; status: 'expected' | 'unexpected' | 'skipped' | 'flaky'; errors?: { message: string }[] }[];
  errors?: { message: string }[];
  nested?: boolean;
}) {
  const specs = (input.tests ?? []).map((test) => ({
    title: test.title,
    ok: test.status === 'expected' || test.status === 'skipped',
    tags: [],
    tests: [
      {
        timeout: 30000,
        annotations: [],
        expectedStatus: 'passed',
        projectName: 'chromium',
        projectId: 'chromium',
        status: test.status,
        results: [
          {
            workerIndex: 0,
            parallelIndex: 0,
            status: test.status === 'expected' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed',
            duration: 1234,
            error: test.errors?.[0],
            errors: test.errors ?? [],
            stdout: [],
            stderr: [],
            retry: 0,
            startTime: '2026-09-09T12:00:00.000Z',
            attachments: [],
            annotations: [],
          },
        ],
      },
    ],
    id: 'abc',
    file: 'repro.spec.ts',
    line: 20,
    column: 1,
  }));
  const fileSuite = { title: 'repro.spec.ts', file: 'repro.spec.ts', column: 0, line: 0, specs: input.nested ? [] : specs, suites: input.nested ? [{ title: 'group', file: 'repro.spec.ts', column: 0, line: 0, specs }] : [] };
  return {
    config: { projects: [] },
    suites: [fileSuite],
    errors: input.errors ?? [],
    stats: {
      startTime: '2026-09-09T12:00:00.000Z',
      duration: 2000,
      expected: specs.filter((s) => s.ok).length,
      unexpected: specs.filter((s) => !s.ok).length,
      flaky: 0,
      skipped: 0,
    },
  };
}

const RED_MESSAGE = '\u001b[31mError: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m).toBeVisible() failed\u001b[0m\n\nLocator: getByTestId(\'order-confirmation\')';

describe('stripAnsi', () => {
  it('removes colour and style escapes', () => {
    expect(stripAnsi(RED_MESSAGE)).toBe("Error: expect(locator).toBeVisible() failed\n\nLocator: getByTestId('order-confirmation')");
  });
});

describe('parseReport', () => {
  it('reports a passing run', () => {
    expect(parseReport(report({ tests: [{ title: 'checkout', status: 'expected' }] }))).toEqual({
      outcome: 'passed',
      failureMessage: null,
      tests: 1,
    });
  });

  it('reports a failing run with the first error message, ANSI stripped', () => {
    const parsed = parseReport(
      report({
        tests: [
          { title: 'checkout', status: 'unexpected', errors: [{ message: RED_MESSAGE }, { message: 'second' }] },
        ],
      }),
    );
    expect(parsed.outcome).toBe('failed');
    expect(parsed.failureMessage).toMatch(/^Error: expect\(locator\)\.toBeVisible\(\) failed/);
    expect(parsed.failureMessage).not.toContain('\u001b');
  });

  it('finds tests inside nested describe suites', () => {
    const parsed = parseReport(report({ nested: true, tests: [{ title: 'inner', status: 'unexpected', errors: [{ message: 'boom' }] }] }));
    expect(parsed).toEqual({ outcome: 'failed', failureMessage: 'boom', tests: 1 });
  });

  it('falls back to a generic message when a failed test carries no error text', () => {
    const parsed = parseReport(report({ tests: [{ title: 'checkout', status: 'unexpected' }] }));
    expect(parsed).toEqual({ outcome: 'failed', failureMessage: 'Test "checkout" did not pass.', tests: 1 });
  });

  it('treats a report without tests as an error, using the global error when there is one', () => {
    const compileError = 'SyntaxError: Unexpected token (12:4)';
    expect(parseReport(report({ errors: [{ message: compileError }] }))).toEqual({
      outcome: 'error',
      failureMessage: compileError,
      tests: 0,
    });
    expect(parseReport(report({}))).toEqual({ outcome: 'error', failureMessage: 'Playwright did not run any test.', tests: 0 });
  });

  it('rejects input that is not a report object', () => {
    expect(parseReport(null).outcome).toBe('error');
    expect(parseReport('nope').outcome).toBe('error');
  });

  it('counts skipped tests as not failing', () => {
    const parsed = parseReport(report({ tests: [{ title: 'a', status: 'skipped' }, { title: 'b', status: 'expected' }] }));
    expect(parsed).toEqual({ outcome: 'passed', failureMessage: null, tests: 2 });
  });
});
