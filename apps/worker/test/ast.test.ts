import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePlaywrightTest } from '@repro/test-generator';
import type { RecordedEvent } from '@repro/contracts';
import { checkAst } from '../src/runner/ast.js';
import { validateTestCode } from '../src/runner/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', '..', 'packages', 'test-generator', 'test', 'fixtures');
const benchDir = path.resolve(here, '..', '..', '..', 'scripts', 'bench', 'fixtures');

describe('AST allowlist accepts everything the generator emits', () => {
  const generatorFixtures = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
  it.each(generatorFixtures)('generator fixture %s', async (file) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8')) as {
      session?: { id: string; projectSlug: string; startedAt: number; initialUrl: string };
      events: RecordedEvent[];
      expectations?: unknown[];
    };
    const output = await generatePlaywrightTest({
      session: fixture.session ?? { id: '11111111-2222-4333-8444-555555555555', projectSlug: 'demo', startedAt: 1_700_000_000_000, initialUrl: 'http://localhost:4100/' },
      events: fixture.events,
      expectations: (fixture.expectations ?? [{ kind: 'visible', testId: 'order-confirmation' }]) as never,
    });
    expect(checkAst(output.code)).toEqual({ ok: true });
    expect(validateTestCode(output.code, 'http://localhost:4100')).toEqual({ ok: true });
  });

  const benchFixtures = fs.existsSync(benchDir) ? fs.readdirSync(benchDir).filter((f) => f.endsWith('.json')) : [];
  it.each(benchFixtures)('recorded fixture %s', async (file) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(benchDir, file), 'utf8')) as {
      expectations: unknown[];
      batch: { meta: { startedAt: number; page: { url: string } }; events: RecordedEvent[] };
    };
    const output = await generatePlaywrightTest({
      session: { id: '11111111-2222-4333-8444-555555555555', projectSlug: 'demo', startedAt: fixture.batch.meta.startedAt, initialUrl: fixture.batch.meta.page.url },
      events: fixture.batch.events,
      expectations: fixture.expectations as never,
    });
    expect(validateTestCode(output.code, 'http://localhost:4100')).toEqual({ ok: true });
  });
});

const wrap = (body: string) => `import { test, expect } from '@playwright/test';\n\ntest('x', async ({ page }) => {\n${body}\n});\n`;

describe('AST allowlist rejects obfuscated escapes the denylist cannot name', () => {
  it.each([
    ['bracket access to window', `await page.evaluate(() => window['fet' + 'ch']('http://internal/x'));`],
    ['constructor chain', `const f = ({}).constructor.constructor('return process')(); f.exit(1);`],
    ['page.request', `await page.request.get('/api/orders');`],
    ['route interception', `await page.route('**/*', (route) => route.continue());`],
    ['string concatenation in a URL', `await page.goto('/' + 'admin');`],
    ['unknown member', `await page.context().newPage();`],
    ['for loop', `for (let i = 0; i < 3; i++) { await page.goto('/'); }`],
    ['throw statement', `throw new Error('x');`],
    ['process.exit', `process.exit(1);`],
    ['env outside fixtures', `const home = process.env.HOME;`],
    ['unknown identifier', `await page.goto(location.href);`],
    ['function declaration', `function f() { return 1; } f();`],
    ['dynamic member', `const key = 'evaluate'; await page[key](() => 1);`],
  ])('%s', (_label, body) => {
    const result = checkAst(wrap(body));
    expect(result.ok).toBe(false);
  });

  it('reports parse errors instead of throwing', () => {
    const result = checkAst('import { test, expect } from \'@playwright/test\';\ntest(');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('does not parse');
  });
});
