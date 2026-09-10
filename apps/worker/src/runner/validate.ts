/**
 * Static checks on generated test code before Playwright ever sees it.
 *
 * The generator (@repro/test-generator) only emits a narrow dialect: one import, page actions,
 * expectations, and an optional `fixture` helper that reads `process.env.REPRO_FIXTURE_*`.
 * Everything else is rejected here, so a tampered row in generated_tests cannot turn the
 * worker into a shell. These checks are pure and unit-tested; see docs/REPRODUCTION_RUNNER.md.
 */

export const MAX_CODE_BYTES = 64 * 1024;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const ALLOWED_IMPORT = /^import \{ test, expect \} from ['"]@playwright\/test['"];?$/;

/**
 * Return the code with comments blanked out. With `keepStrings: false` the contents of string and
 * template literals are blanked as well (the quotes stay), which gives a view that contains only
 * real code tokens. Keyword rules run on that view so that a form value such as "import data"
 * quoted in the test cannot trip them, while URL rules run on the view that keeps strings so a
 * URL hidden inside a literal is still seen. Comments are always dropped: the generator quotes
 * user-facing error messages in `// Recorded error:` lines and those must not cause rejections.
 * Every removed character becomes a space, so the two views line up index by index.
 */
export function stripCode(code: string, options: { keepStrings: boolean }): string {
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';
  const blank = (ch: string) => (ch === '\n' ? ch : ' ');
  while (i < code.length) {
    const ch = code[i]!;
    const next = code[i + 1];
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          state = 'line';
          out += '  ';
          i += 2;
        } else if (ch === '/' && next === '*') {
          state = 'block';
          out += '  ';
          i += 2;
        } else {
          if (ch === "'") state = 'single';
          else if (ch === '"') state = 'double';
          else if (ch === '`') state = 'template';
          out += ch;
          i += 1;
        }
        break;
      case 'line':
        if (ch === '\n') state = 'code';
        out += blank(ch);
        i += 1;
        break;
      case 'block':
        if (ch === '*' && next === '/') {
          state = 'code';
          out += '  ';
          i += 2;
        } else {
          out += blank(ch);
          i += 1;
        }
        break;
      case 'single':
      case 'double':
      case 'template': {
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
        if (ch === '\\') {
          const pair = ch + (next ?? '');
          out += options.keepStrings ? pair : pair.replace(/[^\n]/g, ' ');
          i += 2;
        } else if (ch === quote) {
          state = 'code';
          out += ch;
          i += 1;
        } else {
          out += options.keepStrings ? ch : blank(ch);
          i += 1;
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Validate generated test code. `demoUrl` is the only origin an absolute URL may point at.
 * Returns a human-readable reason on rejection; the run is stored with it and never executed.
 */
export function validateTestCode(code: string, demoUrl: string): ValidationResult {
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > MAX_CODE_BYTES) {
    return { ok: false, reason: `Test code is ${bytes} bytes; the limit is ${MAX_CODE_BYTES} bytes.` };
  }

  const withStrings = stripCode(code, { keepStrings: true });
  const codeOnly = stripCode(code, { keepStrings: false });

  const banned: [RegExp, string][] = [
    [/\brequire\s*\(/, 'require()'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/child_process/, 'child_process'],
    [/\beval\s*\(/, 'eval()'],
    [/\bFunction\s*\(/, 'Function()'],
    [/\bfetch\s*\(/, 'fetch()'],
  ];
  for (const [pattern, label] of banned) {
    const hit = pattern.exec(codeOnly)?.[0];
    if (hit) return { ok: false, reason: `Test code must not use ${label} (found "${hit}").` };
  }
  const moduleRef = /['"`](?:node:)?(?:fs|net)(?:\/[\w./-]*)?['"`]/.exec(withStrings)?.[0];
  if (moduleRef) {
    return { ok: false, reason: `Test code must not reference the fs or net modules (found ${moduleRef}).` };
  }

  const imports = withStrings
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^import\b/.test(line));
  if (imports.length !== 1) {
    return { ok: false, reason: `Expected exactly one import statement, found ${imports.length}.` };
  }
  if (!ALLOWED_IMPORT.test(imports[0]!)) {
    return {
      ok: false,
      reason: `Only \`import { test, expect } from '@playwright/test';\` is allowed, found: ${imports[0]}`,
    };
  }
  // An import that does not start its line (after a semicolon, say) would slip past the line
  // filter, so every import keyword in real code is counted as well.
  if ((codeOnly.match(/\bimport\b/g) ?? []).length !== 1) {
    return { ok: false, reason: 'Only one import is allowed and it must be on its own line.' };
  }

  // The only allowed use of `process` is reading a fixture value. The identifier is located in
  // the code-only view (so "process" inside a string does not count) and what follows it is read
  // from the view that keeps strings, so the fixture name inside the brackets is visible.
  for (const use of codeOnly.matchAll(/\bprocess\b/g)) {
    const tail = withStrings.slice(use.index + 'process'.length, use.index + 'process'.length + 40);
    const compact = tail.replace(/\s+/g, '');
    const allowed = /^\.env\.REPRO_FIXTURE_/.test(compact) || /^\.env\[['"`]REPRO_FIXTURE_/.test(compact);
    if (!allowed) {
      return {
        ok: false,
        reason: `Test code may only read process.env.REPRO_FIXTURE_* (found "process${tail.split('\n')[0]?.trimEnd()}").`,
      };
    }
  }

  const origin = new URL(demoUrl).origin;
  for (const [url] of withStrings.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: `Test code contains a malformed URL: ${url}` };
    }
    if (parsed.origin !== origin) {
      return {
        ok: false,
        reason: `Test code may only reference the demo application at ${origin} (found ${url}).`,
      };
    }
  }

  for (const [call, rest] of withStrings.matchAll(/page\s*\.\s*goto\s*\(([^\n]{0,40})/g)) {
    // A relative path literal ('/checkout') resolves against baseURL. Anything else (a variable,
    // a template, an absolute URL, a protocol-relative '//host') is rejected.
    if (!/^\s*['"]\/(?!\/)/.test(rest ?? '')) {
      return { ok: false, reason: `page.goto() must receive a relative path literal (found "${call.trim()}").` };
    }
  }

  return { ok: true };
}
