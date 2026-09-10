import { ping } from '@/lib/api';

/** Liveness for the dashboard itself plus the result of pinging the ingest service. */
export async function GET(): Promise<Response> {
  const ingest = await ping();
  return Response.json({ ok: true, ingest }, { headers: { 'cache-control': 'no-store' } });
}
