import type { Db } from '@repro/db';

/** Drizzle's transaction handle has the same query API as the root client; the queue helper only needs that. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const asDb = (tx: Tx): Db => tx as unknown as Db;
