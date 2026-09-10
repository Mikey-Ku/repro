/** Click, input and submit capture with element descriptors, independent of rrweb. */
import { beforeEach, describe, expect, it } from 'vitest';
import { $, fire, html, makeClient, ofType, resetDom, setChecked, setValue } from './helpers.js';

describe('interaction capture (rrweb off)', () => {
  beforeEach(() => resetDom());

  it('describes the closest interactive ancestor of a click', async () => {
    html(`
      <form id="login" data-testid="login-form">
        <button type="submit" data-testid="submit" id="submit-btn" aria-label="Sign in"><span class="icon"></span><span>Go</span></button>
        <a href="/help?token=abc&topic=login">Help</a>
      </form>
    `);
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    fire($('#submit-btn .icon'), 'click', { clientX: 10.4, clientY: 20.6 });
    fire($('a'), 'click');
    await harness.client.flush();
    expect(harness.fetch.errors).toEqual([]);
    const clicks = ofType(harness.fetch.events(), 'click');
    expect(clicks[0]?.data).toMatchObject({ x: 10, y: 21 });
    expect(clicks[0]?.data.target).toMatchObject({
      tag: 'button',
      testId: 'submit',
      id: 'submit-btn',
      type: 'submit',
      role: 'button',
      accessibleName: 'Sign in',
      ariaLabel: 'Sign in',
      text: 'Go',
      formId: 'login',
      formTestId: 'login-form',
      sensitive: false,
    });
    expect(clicks[0]?.data.target.cssPath).toBe('button#submit-btn');
    expect(clicks[1]?.data.target).toMatchObject({ tag: 'a', role: 'link', text: 'Help', href: 'http://localhost:3000/help?token=%5Bredacted%5D&topic=login' });
    // Descriptors never carry rrweb node ids or the element's value.
    expect(JSON.stringify(clicks)).not.toMatch(/"(nodeId|rrId|value)"/);
  });

  it('records change events with kind, value and checked state', async () => {
    html(`
      <label>Email <input id="email" type="email" name="email"></label>
      <label for="bio">Bio</label><textarea id="bio" name="bio"></textarea>
      <select id="plan" name="plan"><option value="a">Basic</option><option value="b">Plus</option></select>
      <input id="agree" type="checkbox" name="agree">
      <input id="r1" type="radio" name="size" value="s"><input id="r2" type="radio" name="size" value="m">
      <input id="file" type="file" name="upload">
    `);
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    setValue($('#email'), 'a@b.co');
    setValue($('#bio'), 'hello there');
    setValue($('#plan'), 'b');
    setChecked($('#agree'), true);
    setChecked($('#r2'), true);
    fire($('#file'), 'change');
    await harness.client.flush();
    const inputs = ofType(harness.fetch.events(), 'input').map((e) => e.data);
    expect(inputs).toMatchObject([
      { kind: 'text', value: 'a@b.co', masked: false, target: { tag: 'input', type: 'email', role: 'textbox', label: 'Email', accessibleName: 'Email' } },
      { kind: 'textarea', value: 'hello there', masked: false, target: { label: 'Bio' } },
      { kind: 'select', value: 'b', masked: false, target: { tag: 'select', role: 'combobox', text: 'Plus' } },
      { kind: 'checkbox', checked: true, target: { role: 'checkbox' } },
      { kind: 'radio', checked: true, target: { name: 'size' } },
      { kind: 'other', value: null, masked: true },
    ]);
  });

  it('masks values for controls that look sensitive, by type, autocomplete, name, label or placeholder', async () => {
    html(`
      <input id="a" type="password" name="p">
      <input id="b" name="x" autocomplete="one-time-code">
      <input id="c" name="cardNumber">
      <label for="d">Social security number</label><input id="d" name="d">
      <input id="e" name="e" placeholder="CVV">
      <input id="f" name="f" aria-label="Account number">
      <input id="g" name="shipping_city">
    `);
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) setValue($(`#${id}`), `value-${id}`);
    await harness.client.flush();
    const inputs = ofType(harness.fetch.events(), 'input').map((e) => [e.data.target.id ?? e.data.target.name, e.data.masked, e.data.value]);
    expect(inputs).toEqual([
      ['a', true, null],
      ['b', true, null],
      ['c', true, null],
      ['d', true, null],
      ['e', true, null],
      ['f', true, null],
      ['g', false, 'value-g'],
    ]);
    expect(harness.fetch.text()).not.toMatch(/value-[a-f]/);
  });

  it('records submit with the form descriptor', async () => {
    html('<form id="pay" data-testid="pay-form"><input name="q"></form>');
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    fire($('#pay'), 'submit');
    await harness.client.flush();
    const [submit] = ofType(harness.fetch.events(), 'submit');
    expect(submit?.data.target).toMatchObject({ tag: 'form', id: 'pay', testId: 'pay-form' });
  });

  it('captures console.error and console.warn only, and unwraps on stop', async () => {
    const error = console.error;
    const warn = console.warn;
    const log = console.log;
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    expect(console.error).not.toBe(error);
    expect(console.log).toBe(log);
    console.error('boom', { password: 'x', count: 2 }, new Error('inner'));
    console.warn('careful');
    await harness.client.flush();
    const events = ofType(harness.fetch.events(), 'console').map((e) => e.data);
    expect(events).toEqual([
      { level: 'error', args: ['boom', '{"password":"[redacted]","count":2}', 'Error: inner'] },
      { level: 'warn', args: ['careful'] },
    ]);
    harness.client.stop();
    expect(console.error).toBe(error);
    expect(console.warn).toBe(warn);
  });
});
