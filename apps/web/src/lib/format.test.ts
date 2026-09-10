import { describe, expect, it } from 'vitest';
import { formatBrowser, formatDuration, formatOffset, formatRelative, shortId } from './format';

describe('formatOffset', () => {
  it('renders mm:ss.mmm', () => {
    expect(formatOffset(0)).toBe('00:00.000');
    expect(formatOffset(1)).toBe('00:00.001');
    expect(formatOffset(999)).toBe('00:00.999');
    expect(formatOffset(1000)).toBe('00:01.000');
    expect(formatOffset(61_005)).toBe('01:01.005');
  });

  it('rolls hours into minutes rather than adding a third group', () => {
    expect(formatOffset(3_600_000)).toBe('60:00.000');
    expect(formatOffset(2 * 3_600_000 + 30_500)).toBe('120:30.500');
  });

  it('clamps negative, fractional and non-finite input', () => {
    expect(formatOffset(-500)).toBe('00:00.000');
    expect(formatOffset(1234.6)).toBe('00:01.235');
    expect(formatOffset(Number.NaN)).toBe('00:00.000');
    expect(formatOffset(Number.POSITIVE_INFINITY)).toBe('00:00.000');
  });
});

describe('formatDuration', () => {
  it('picks a unit by magnitude', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(4200)).toBe('4.2 s');
    expect(formatDuration(192_000)).toBe('3m 12s');
    expect(formatDuration(3_840_000)).toBe('1h 04m');
    expect(formatDuration(null)).toBe('n/a');
  });
});

describe('formatRelative', () => {
  it('is deterministic when given a reference time', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    expect(formatRelative('2026-09-09T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-09-09T11:45:00Z', now)).toBe('15 min ago');
    expect(formatRelative('2026-09-09T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-09-07T12:00:00Z', now)).toBe('2 d ago');
    expect(formatRelative(null, now)).toBe('never');
  });
});

describe('small helpers', () => {
  it('shortens ids and browser versions', () => {
    expect(shortId('0d1c2b3a-4444-5555-6666-777788889999')).toBe('0d1c2b3a');
    expect(formatBrowser('Chrome', '128.0.6613.84')).toBe('Chrome 128');
    expect(formatBrowser(null, null)).toBe('Unknown');
  });
});
