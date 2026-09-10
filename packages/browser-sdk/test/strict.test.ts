/** Strict mode masks every free-text control, not only the ones that look sensitive. */
import { beforeEach, describe, expect, it } from 'vitest';
import { CANARIES } from './canaries.js';
import { $, html, makeClient, ofType, resetDom, setChecked, setValue, tick } from './helpers.js';

const PAGE = `
  <form id="profile">
    <label for="nickname">Nickname</label>
    <input id="nickname" name="nickname" value="${CANARIES.CANARY_STRICT_TEXT_}">
    <label for="bio">Bio</label>
    <textarea id="bio" name="bio">${CANARIES.CANARY_STRICT_TEXT_}</textarea>
    <label for="agree">Agree</label>
    <input id="agree" type="checkbox" name="agree">
    <select id="plan" name="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
  </form>
`;

async function drive(strict: boolean) {
  const harness = makeClient({ strict });
  html(PAGE);
  harness.client.start();
  await tick(20);
  setValue($('#nickname'), CANARIES.CANARY_STRICT_TEXT_);
  setValue($('#bio'), CANARIES.CANARY_STRICT_TEXT_);
  setChecked($('#agree'), true);
  setValue($('#plan'), 'pro');
  await tick(20);
  await harness.client.flush();
  expect(harness.fetch.errors).toEqual([]);
  return harness;
}

describe('strict mode', () => {
  beforeEach(() => resetDom());

  it('records plain text controls in normal mode', async () => {
    const harness = await drive(false);
    const inputs = ofType(harness.fetch.events(), 'input');
    expect(inputs.find((e) => e.data.target.name === 'nickname')?.data).toMatchObject({
      value: CANARIES.CANARY_STRICT_TEXT_,
      masked: false,
    });
    expect(inputs.find((e) => e.data.target.name === 'bio')?.data.masked).toBe(false);
    // The rrweb snapshot also carries the value, because nothing hinted it was secret.
    expect(harness.fetch.text()).toContain(CANARIES.CANARY_STRICT_TEXT_);
  });

  it('masks every text input and textarea in strict mode, in rrweb and in input events', async () => {
    const harness = await drive(true);
    const inputs = ofType(harness.fetch.events(), 'input');
    expect(inputs.find((e) => e.data.target.name === 'nickname')?.data).toMatchObject({ value: null, masked: true });
    expect(inputs.find((e) => e.data.target.name === 'bio')?.data).toMatchObject({ value: null, masked: true });
    expect(harness.fetch.text()).not.toContain(CANARIES.CANARY_STRICT_TEXT_);
  });

  it('still records checkboxes and selects in strict mode', async () => {
    const harness = await drive(true);
    const inputs = ofType(harness.fetch.events(), 'input');
    expect(inputs.find((e) => e.data.target.name === 'agree')?.data).toMatchObject({ kind: 'checkbox', checked: true });
    expect(inputs.find((e) => e.data.target.name === 'plan')?.data).toMatchObject({ kind: 'select', value: 'pro', masked: false });
  });

  it('honours user selectors on top of the defaults', async () => {
    const harness = makeClient({ maskSelector: '.secret-text', ignoreSelector: '.no-record' });
    html(`
      <p class="secret-text">${CANARIES.CANARY_MASKED_TEXT_}</p>
      <input id="a" name="a" class="secret-text">
      <input id="b" name="b" class="no-record">
      <input id="c" name="c">
    `);
    harness.client.start();
    await tick(20);
    setValue($('#a'), 'alpha');
    setValue($('#b'), 'bravo');
    setValue($('#c'), 'charlie');
    await tick(20);
    await harness.client.flush();
    const inputs = ofType(harness.fetch.events(), 'input');
    expect(inputs.map((e) => [e.data.target.name, e.data.value])).toEqual([
      ['a', null],
      ['c', 'charlie'],
    ]);
    expect(harness.fetch.text()).not.toContain(CANARIES.CANARY_MASKED_TEXT_);
    expect(harness.fetch.text()).not.toContain('bravo');
  });
});
