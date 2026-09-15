// Orders table example. Bug class: an exception on user interaction with real data.
import { byId, demo, formatMoney, query, repro } from './shared.js';

type SortColumn = 'id' | 'customer' | 'total' | 'status';
type Direction = 'asc' | 'desc';
interface Order {
  id: string;
  customer: string;
  /** Integer cents, or null while the order is "pending pricing". */
  total: number | null;
  status: string;
  placedAt: string;
}
/** The shape the sort was written against, before orders could exist without a price. */
interface PricedOrder {
  total: number;
}
interface OrdersResponse {
  ok: boolean;
  rows: Order[];
  page: number;
  pageCount: number;
  total: number;
  error?: string;
}

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'id', label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: 'total', label: 'Total' },
  { key: 'status', label: 'Status' },
];

const state = {
  q: '',
  status: '',
  sort: '' as '' | SortColumn,
  dir: 'asc' as Direction,
  page: 1,
  pageCount: 1,
  total: 0,
  rows: [] as Order[],
};

const slot = byId<HTMLElement>('orders-slot');
const searchForm = byId<HTMLFormElement>('search-form');
const search = byId<HTMLInputElement>('order-search');
const statusFilter = byId<HTMLSelectElement>('status-filter');
const prevButton = query<HTMLButtonElement>('[data-testid="prev-page"]');
const nextButton = query<HTMLButtonElement>('[data-testid="next-page"]');
const pageLabel = query<HTMLElement>('[data-testid="page-label"]');

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.q = search.value.trim();
  state.page = 1;
  void load();
});
statusFilter.addEventListener('change', () => {
  state.status = statusFilter.value;
  state.page = 1;
  void load();
});
prevButton.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  void load();
});
nextButton.addEventListener('click', () => {
  if (state.page >= state.pageCount) return;
  state.page += 1;
  void load();
});
void load();

function showLoading(text: string): void {
  const loading = document.createElement('p');
  loading.className = 'loading';
  loading.setAttribute('role', 'status');
  loading.dataset.testid = 'orders-loading';
  loading.textContent = text;
  slot.replaceChildren(loading);
}

async function load(): Promise<void> {
  showLoading('Loading orders…');
  const params = new URLSearchParams({
    q: state.q,
    status: state.status,
    sort: state.sort,
    dir: state.dir,
    page: String(state.page),
  });
  try {
    const response = await fetch(`/api/examples/orders?${params.toString()}`);
    const data = (await response.json()) as OrdersResponse;
    if (!response.ok || !data.ok) throw new Error(data.error ?? `Orders request failed with ${response.status}`);
    state.rows = data.rows;
    state.page = data.page;
    state.pageCount = data.pageCount;
    state.total = data.total;
    renderTable();
    repro.annotate('orders:loaded', { rows: data.rows.length, page: data.page });
  } catch (cause) {
    const failed = document.createElement('p');
    failed.className = 'alert';
    failed.dataset.visible = 'true';
    failed.setAttribute('role', 'alert');
    failed.textContent = 'We could not load your orders. Please refresh the page.';
    slot.replaceChildren(failed);
    repro.captureException(cause, { where: 'orders:load' });
  }
}

/**
 * Sorts the visible rows in the browser so the click feels instant. The same sort and direction
 * go with every later request, so the next page and the next search continue in this order.
 */
function sortBy(column: SortColumn): void {
  state.dir = state.sort === column && state.dir === 'asc' ? 'desc' : 'asc';
  state.sort = column;
  showLoading('Sorting orders…');
  state.rows = [...state.rows].sort((a, b) => compareOrders(a, b, column, state.dir));
  renderTable();
}

/**
 * Compares two orders on a column. Both code paths live here on purpose: the total column is the
 * only one that can be null, and it was not null when the sort was written.
 */
function compareOrders(a: Order, b: Order, column: SortColumn, dir: Direction): number {
  const sign = dir === 'desc' ? -1 : 1;
  if (column === 'total') {
    if (demo.mode === 'broken') {
      // BUG (broken mode): two orders are still "pending pricing", so their total is null and
      // null has no toFixed. The throw skips renderTable() and the spinner never goes away.
      const left = a as unknown as PricedOrder;
      const right = b as unknown as PricedOrder;
      return sign * left.total.toFixed(2).localeCompare(right.total.toFixed(2));
    }
    // FIX: compare totals as numbers and keep the unpriced orders at the end in both directions.
    if (a.total === null || b.total === null) return Number(a.total === null) - Number(b.total === null);
    return sign * (a.total - b.total);
  }
  return sign * a[column].localeCompare(b[column]);
}

function renderTable(): void {
  const table = document.createElement('table');
  table.className = 'orders';
  table.dataset.testid = 'orders-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    th.scope = 'col';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = column.label;
    button.addEventListener('click', () => sortBy(column.key));
    th.appendChild(button);
    if (state.sort === column.key) {
      th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      const mark = document.createElement('span');
      mark.className = 'sort-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = state.dir === 'asc' ? '↑' : '↓';
      th.appendChild(mark);
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  if (state.rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    td.className = 'unpriced';
    td.textContent = 'No orders match.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const order of state.rows) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'order-row';
    tr.dataset.orderId = order.id;
    const id = document.createElement('td');
    id.textContent = order.id;
    const customer = document.createElement('td');
    customer.textContent = order.customer;
    const total = document.createElement('td');
    total.className = 'total';
    if (order.total === null) {
      const pending = document.createElement('span');
      pending.className = 'unpriced';
      pending.textContent = 'Pending pricing';
      total.appendChild(pending);
    } else {
      total.textContent = formatMoney(order.total);
    }
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${order.status}`;
    badge.textContent = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    status.appendChild(badge);
    tr.append(id, customer, total, status);
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  slot.replaceChildren(table);
  pageLabel.textContent = `Page ${state.page} of ${state.pageCount} · ${state.total} orders`;
  prevButton.disabled = state.page <= 1;
  nextButton.disabled = state.page >= state.pageCount;
}
