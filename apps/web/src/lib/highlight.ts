import 'server-only';

import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki';

/**
 * Server-side syntax highlighting for generated Playwright tests.
 * One highlighter is created per process and reused: loading a grammar is the
 * expensive part. The JavaScript regex engine avoids shipping a WASM binary
 * through the Next.js bundler.
 */
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ['github-dark'],
    langs: ['typescript'],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighterPromise;
}

/** Returns HTML. Shiki escapes the code itself, so the output is safe to inject. */
export async function highlightTypescript(code: string): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, { lang: 'typescript', theme: 'github-dark' });
}
