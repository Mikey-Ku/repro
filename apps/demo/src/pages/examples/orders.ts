import { ORDER_STATUSES } from '../../examples/orders.js';
import { escapeHtml } from '../../html.js';
import { renderLayout, type DemoPageConfig } from '../../layout.js';
import { EXAMPLE_STYLES } from './styles.js';

const STATUS_LABELS: Record<(typeof ORDER_STATUSES)[number], string> = {
  pending: 'Pending',
  paid: 'Paid',
  shipped: 'Shipped',
  refunded: 'Refunded',
};

export function renderOrdersPage(demo: DemoPageConfig): string {
  const statuses = ORDER_STATUSES.map(
    (status) => `<option value="${status}">${escapeHtml(STATUS_LABELS[status])}</option>`,
  ).join('');

  const body = `
    <h1>Orders</h1>
    <p class="lede">Search, filter and sort recent orders. Two of them are still pending pricing.</p>

    <form class="toolbar" data-testid="search-form" id="search-form" role="search" action="/examples/orders" method="get">
      <div class="field">
        <label for="order-search">Search orders</label>
        <input type="text" name="q" id="order-search" autocomplete="off">
        <span class="hint">Order id or customer. Press Enter to search.</span>
      </div>
      <div class="field">
        <label for="status-filter">Filter by status</label>
        <select name="status" id="status-filter">
          <option value="">All statuses</option>${statuses}
        </select>
      </div>
    </form>

    <div id="orders-slot" aria-live="polite">
      <p class="loading" role="status" data-testid="orders-loading">Loading orders…</p>
    </div>

    <nav class="pager" aria-label="Pagination">
      <button class="btn btn-secondary" type="button" data-testid="prev-page" disabled>Previous</button>
      <span data-testid="page-label">Page 1</span>
      <button class="btn btn-secondary" type="button" data-testid="next-page" disabled>Next</button>
    </nav>`;

  return renderLayout({ title: 'Orders', page: 'orders', body, demo, styles: EXAMPLE_STYLES, script: '/examples/orders.js' });
}
