/** rrweb runs under happy-dom with the shims in setup.ts. If this fails, every rrweb-backed test will. */
import { describe, expect, it } from 'vitest';
import { record } from 'rrweb';
import { EventType } from '@rrweb/types';

describe('rrweb under happy-dom', () => {
  it('emits a meta and full snapshot with the password value masked', async () => {
    document.body.innerHTML = '<form><input type="password" value="pw"><p>hello</p></form>';
    const events: Array<{ type: number }> = [];
    const stop = record({ emit: (e) => events.push(e) });
    await new Promise((r) => setTimeout(r, 50));
    stop?.();
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining([EventType.Meta, EventType.FullSnapshot]));
    const json = JSON.stringify(events);
    // happy-dom defines textContent on CharacterData rather than Node, so rrweb's untainted
    // accessor reads text nodes as empty here. Real browsers (covered by the E2E suite) record
    // the text. This smoke test therefore only asserts the masking behaviour.
    expect(json).toContain('"tagName":"p"');
    expect(json).not.toContain('"pw"');
    expect(json).toContain('"value":"**"');
  });
});
