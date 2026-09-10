/** identify(), annotate() and captureException() input rules. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient, ofType, resetDom } from './helpers.js';

async function identify(userId: string, traits?: Record<string, string | number | boolean>) {
  const harness = makeClient({}, { rrweb: false });
  harness.client.start();
  harness.client.identify(userId, traits);
  await harness.client.flush();
  expect(harness.fetch.errors).toEqual([]);
  return ofType(harness.fetch.events(), 'identify');
}

describe('identify()', () => {
  beforeEach(() => resetDom());

  it('records an opaque id', async () => {
    const events = await identify('user_42');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ userId: 'user_42' });
  });

  it('refuses email-shaped ids entirely', async () => {
    expect(await identify('alice@example.com')).toHaveLength(0);
    expect(await identify('  bob.smith@corp.example.co.uk ')).toHaveLength(0);
  });

  it('ignores empty ids', async () => {
    expect(await identify('   ')).toHaveLength(0);
  });

  it('drops trait keys that look sensitive and keeps the rest', async () => {
    const [event] = await identify('user_42', {
      plan: 'pro',
      seats: 3,
      beta: true,
      password: 'hunter2',
      apiKey: 'ak_prod_abcdefghijklmnop',
      ssn: '123-45-6789',
      creditCard: '4111111111111111',
      sessionToken: 'abc',
    });
    expect(event?.data.traits).toEqual({ plan: 'pro', seats: 3, beta: true });
  });

  it('scrubs and truncates string traits', async () => {
    const [event] = await identify('user_42', { note: 'auth Bearer abcdef123456', long: 'x'.repeat(400) });
    expect(event?.data.traits?.note).toBe('auth Bearer [redacted]');
    expect(String(event?.data.traits?.long).length).toBeLessThanOrEqual(200);
  });

  it('omits traits when nothing survives', async () => {
    const [event] = await identify('user_42', { password: 'x', nested: { a: 1 } as unknown as string });
    expect(event?.data).toEqual({ userId: 'user_42' });
  });
});

describe('annotate() and captureException()', () => {
  beforeEach(() => resetDom());

  it('annotate drops sensitive keys and ignores empty names', async () => {
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    harness.client.annotate('   ');
    harness.client.annotate('cart', { items: 2, coupon: 'SPRING', token: 'nope' });
    await harness.client.flush();
    const events = ofType(harness.fetch.events(), 'annotation');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ name: 'cart', data: { items: 2, coupon: 'SPRING' } });
  });

  it('captureException records handled errors with scrubbed message, stack and context', async () => {
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    harness.client.captureException(new RangeError('bad input token=abc123'), { route: '/pay', password: 'x' });
    harness.client.captureException('a plain string');
    harness.client.captureException({ message: 'object with message', name: 'Custom' });
    await harness.client.flush();
    const events = ofType(harness.fetch.events(), 'error');
    expect(events).toHaveLength(3);
    expect(events[0]?.data).toMatchObject({
      kind: 'captured',
      handled: true,
      name: 'RangeError',
      message: 'bad input token=[redacted]',
      context: { route: '/pay' },
    });
    expect(events[0]?.data.stack).toContain('RangeError');
    expect(events[0]?.data.stack).not.toContain('abc123');
    expect(events[1]?.data.message).toBe('a plain string');
    expect(events[2]?.data).toMatchObject({ name: 'Custom', message: 'object with message' });
  });
});
