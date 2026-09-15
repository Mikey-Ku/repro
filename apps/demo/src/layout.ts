import { escapeHtml, serializeForScript } from './html.js';
import type { DemoMode } from './env.js';

/** Values the page hands to the browser bundle through window.__DEMO__. */
export interface DemoPageConfig {
  projectKey: string;
  endpoint: string;
  mode: DemoMode;
  release: string;
}

export interface LayoutOptions {
  title: string;
  /** Identifies the page to the browser bundle via <body data-page>. */
  page: 'login' | 'checkout' | 'order' | 'error' | 'examples' | 'settings' | 'inbox' | 'orders' | 'signup';
  body: string;
  demo: DemoPageConfig;
  /** Extra markup rendered outside the main card (for example the support widget). */
  after?: string;
  /** The browser bundle for the page. Northwind pages share /app.js; each example has its own. */
  script?: string;
  /** Extra CSS appended to the base stylesheet (the examples share one block). */
  styles?: string;
}

const STYLES = `
  :root {
    --bg: #f4f2ee;
    --surface: #ffffff;
    --border: #d9d4cc;
    --text: #1f2429;
    --muted: #5b6470;
    --accent: #1d5c4b;
    --accent-strong: #154536;
    --accent-soft: #e4efe9;
    --danger: #a3271d;
    --danger-soft: #fbe9e7;
    --ring: 0 0 0 3px rgba(29, 92, 75, 0.35);
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); color: var(--text); }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
    outline: none;
    box-shadow: var(--ring);
    border-color: var(--accent);
  }
  .topbar {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .topbar-inner {
    max-width: 640px;
    margin: 0 auto;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--text);
    text-decoration: none;
  }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
  }
  .topbar nav { font-size: 14px; color: var(--muted); }
  .topbar nav a { margin-left: 16px; color: var(--muted); text-decoration: none; }
  .topbar nav a:hover { color: var(--text); text-decoration: underline; }
  main { max-width: 640px; margin: 32px auto; padding: 0 20px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px;
    box-shadow: 0 1px 2px rgba(20, 24, 30, 0.04), 0 8px 24px rgba(20, 24, 30, 0.05);
  }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  .lede { margin: 0 0 24px; color: var(--muted); }
  fieldset { border: 0; padding: 0; margin: 0 0 20px; }
  legend {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0;
    margin-bottom: 12px;
  }
  .field { display: flex; flex-direction: column; margin-bottom: 14px; }
  .field label { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .field .hint { font-size: 13px; color: var(--muted); margin-top: 4px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .row-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; }
  @media (max-width: 480px) { .row, .row-3 { grid-template-columns: 1fr; } }
  input[type="text"], input[type="email"], input[type="password"], input[type="tel"], select {
    font: inherit;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #fff;
    color: var(--text);
    width: 100%;
  }
  select { appearance: auto; }
  .check { display: flex; align-items: center; gap: 10px; font-size: 14px; }
  .check input { width: 18px; height: 18px; accent-color: var(--accent); }
  .btn {
    font: inherit;
    font-weight: 600;
    padding: 12px 18px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    width: 100%;
  }
  .btn:hover { background: var(--accent-strong); }
  .btn[disabled] { opacity: 0.65; cursor: progress; }
  .alert {
    display: none;
    margin: 0 0 16px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 14px;
  }
  .alert[data-visible="true"] { display: block; }
  .summary { border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; margin: 0 0 24px; background: #fbfaf8; }
  .summary-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .summary-head h2 { margin: 0; }
  .account { font-size: 13px; color: var(--muted); }
  .summary ul { list-style: none; margin: 0; padding: 0; }
  .summary li { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; }
  .summary li .qty { color: var(--muted); margin-left: 6px; }
  .summary .totals { border-top: 1px solid var(--border); margin-top: 8px; padding-top: 8px; }
  .summary .totals li.total { font-weight: 700; font-size: 16px; }
  .skeleton { color: var(--muted); font-size: 14px; }
  .confirmation {
    border: 1px solid #b9d9c9;
    background: var(--accent-soft);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .confirmation h2 { margin: 0 0 6px; color: var(--accent-strong); }
  .confirmation p { margin: 0 0 6px; }
  .support {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 260px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(20, 24, 30, 0.12);
    font-size: 13px;
    overflow: hidden;
  }
  .support-head { background: var(--accent); color: #fff; padding: 8px 12px; font-weight: 600; }
  .support-body { padding: 10px 12px; color: var(--muted); }
  .support-body .bubble { background: var(--bg); border-radius: 8px; padding: 8px 10px; margin-top: 6px; color: var(--text); }
  @media (max-width: 720px) { .support { display: none; } }
  footer { max-width: 640px; margin: 0 auto 40px; padding: 0 20px; font-size: 13px; color: var(--muted); }
  footer code { background: #ebe8e2; padding: 1px 6px; border-radius: 4px; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;

export function renderLayout(options: LayoutOptions): string {
  const { title, page, body, demo, after = '', script = '/app.js', styles = '' } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Northwind Supply</title>
<style>${STYLES}${styles}</style>
<script>window.__DEMO__ = ${serializeForScript(demo)};</script>
<script src="/vendor/repro.iife.js"></script>
</head>
<body data-page="${escapeHtml(page)}" data-mode="${escapeHtml(demo.mode)}">
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/checkout"><span class="brand-mark" aria-hidden="true">N</span>Northwind Supply</a>
    <nav aria-label="Primary">
      <a href="/login">Sign in</a>
      <a href="/checkout">Checkout</a>
    </nav>
  </div>
</header>
<main>
  <div class="card">
${body}
  </div>
</main>
${after}
<footer>
  <p>Demo store used by Repro. Mode: <code data-testid="demo-mode">${escapeHtml(demo.mode)}</code> · Release <code>${escapeHtml(demo.release)}</code> · <a href="/examples" data-testid="examples-link">Examples gallery</a></p>
</footer>
<script src="${escapeHtml(script)}" type="module"></script>
</body>
</html>
`;
}
