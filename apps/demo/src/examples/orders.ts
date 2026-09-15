import { z } from 'zod';

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SORT_COLUMNS = ['id', 'customer', 'total', 'status'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export const PAGE_SIZE = 8;

export interface ExampleOrder {
  id: string;
  customer: string;
  /** Integer cents, or null while the order is still "pending pricing". */
  total: number | null;
  status: OrderStatus;
  placedAt: string;
}

const CUSTOMERS = [
  'Grace Hopper',
  'Ada Lovelace',
  'Alan Turing',
  'Katherine Johnson',
  'Margaret Hamilton',
  'Barbara Liskov',
  'Edsger Dijkstra',
  'Radia Perlman',
] as const;

const STATUS_CYCLE: OrderStatus[] = ['shipped', 'paid', 'shipped', 'refunded', 'paid', 'shipped', 'paid', 'pending'];

/** Order ids that are still pending pricing; their total is null on purpose. */
export const UNPRICED_ORDER_IDS = ['NW-1024', 'NW-1023'] as const;

/**
 * Twenty-four orders, newest first. Deterministic so tests and docs can name specific rows:
 * NW-1024 (Grace Hopper) and NW-1023 (Ada Lovelace) have no total yet.
 */
export const ORDERS: readonly ExampleOrder[] = Array.from({ length: 24 }, (_, index) => {
  const number = 1024 - index;
  const id = `NW-${number}`;
  const unpriced = (UNPRICED_ORDER_IDS as readonly string[]).includes(id);
  const placed = new Date(Date.UTC(2026, 8, 1, 9, 0, 0) - index * 86_400_000);
  return {
    id,
    customer: CUSTOMERS[index % CUSTOMERS.length]!,
    total: unpriced ? null : 1250 + ((number * 37) % 900) * 10,
    status: unpriced ? 'pending' : STATUS_CYCLE[index % STATUS_CYCLE.length]!,
    placedAt: placed.toISOString(),
  };
});

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(['', ...values]).default('');

/** Empty strings are accepted for every parameter so `?q=&status=&sort=&dir=&page=` means "defaults". */
export const OrdersQuery = z.object({
  q: z.string().trim().max(100).default(''),
  status: optionalEnum(ORDER_STATUSES),
  sort: optionalEnum(SORT_COLUMNS),
  dir: z.enum(['', 'asc', 'desc']).default(''),
  page: z.preprocess((value) => (value === '' || value === undefined ? 1 : value), z.coerce.number().int().min(1).max(1000)),
});
export type OrdersQueryInput = z.infer<typeof OrdersQuery>;

export interface OrdersPage {
  rows: ExampleOrder[];
  page: number;
  pageCount: number;
  total: number;
  sort: SortColumn | '';
  dir: 'asc' | 'desc';
}

/** Server-side compare. Orders without a price sort last in both directions. */
export function compareOrders(a: ExampleOrder, b: ExampleOrder, column: SortColumn, dir: 'asc' | 'desc'): number {
  const sign = dir === 'desc' ? -1 : 1;
  if (column === 'total') {
    if (a.total === null || b.total === null) return Number(a.total === null) - Number(b.total === null);
    return sign * (a.total - b.total) || a.id.localeCompare(b.id);
  }
  return sign * a[column].localeCompare(b[column]) || a.id.localeCompare(b.id);
}

export function queryOrders(input: OrdersQueryInput): OrdersPage {
  const q = input.q.toLowerCase();
  const dir = input.dir === '' ? 'asc' : input.dir;
  let rows = ORDERS.filter(
    (order) =>
      (q === '' || order.id.toLowerCase().includes(q) || order.customer.toLowerCase().includes(q)) &&
      (input.status === '' || order.status === input.status),
  );
  if (input.sort !== '') {
    const column = input.sort;
    rows = [...rows].sort((a, b) => compareOrders(a, b, column, dir));
  }
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(input.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  return { rows: rows.slice(start, start + PAGE_SIZE), page, pageCount, total, sort: input.sort, dir };
}
