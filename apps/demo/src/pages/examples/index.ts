import type { ExampleMeta } from '../../examples/registry.js';
import { escapeHtml } from '../../html.js';
import { renderLayout, type DemoPageConfig } from '../../layout.js';
import { EXAMPLE_STYLES } from './styles.js';

export function renderExamplesIndexPage(demo: DemoPageConfig, examples: readonly ExampleMeta[]): string {
  const cards = examples
    .map(
      (example) => `
      <li class="example-card" data-testid="example-card-${escapeHtml(example.slug)}">
        <h2><a href="${escapeHtml(example.path)}">${escapeHtml(example.title)}</a></h2>
        <p>${escapeHtml(example.summary)}</p>
        <p class="meta">Element: ${escapeHtml(example.element)}. Bug class: <strong>${escapeHtml(example.bugClass)}</strong>.</p>
      </li>`,
    )
    .join('');

  const body = `
    <h1>Examples gallery</h1>
    <p class="lede">Four small applications, each built around one foundational UI element and broken in a different way.
    They follow the demo's global mode: <code>broken</code> reproduces the bug, <code>fixed</code> shows the intended behaviour.</p>
    <ul class="gallery" data-testid="examples-gallery">${cards}
    </ul>
    <p>The <a href="/checkout">Northwind checkout</a> is the original example: a TypeError after a successful request.</p>`;

  return renderLayout({ title: 'Examples', page: 'examples', body, demo, styles: EXAMPLE_STYLES });
}
