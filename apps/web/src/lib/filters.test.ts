import { describe, expect, it } from 'vitest';
import { parseSessionFilters, withCursor } from './filters';

describe('parseSessionFilters', () => {
  it('maps form values onto the API filters', () => {
    const { filters, form } = parseSessionFilters({
      status: 'completed',
      release: '1.2.0',
      route: '/checkout',
      browser: 'Chrome',
      hasErrors: 'true',
      from: '2026-09-01T10:30',
      to: '2026-09-02T00:00',
    });
    expect(filters).toMatchObject({
      status: 'completed',
      release: '1.2.0',
      route: '/checkout',
      browser: 'Chrome',
      hasErrors: true,
      from: '2026-09-01T10:30:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
    });
    expect(form.hasErrors).toBe(true);
    expect(form.from).toBe('2026-09-01T10:30');
  });

  it('treats empty strings as unset and drops invalid values instead of failing', () => {
    const { filters, form } = parseSessionFilters({ status: '', release: '', from: 'not a date' });
    expect(filters.status).toBeUndefined();
    expect(filters.release).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(form.status).toBe('');

    const bad = parseSessionFilters({ status: 'bogus' });
    expect(bad.filters.status).toBeUndefined();
  });

  it('uses the first value when a param repeats', () => {
    const { filters } = parseSessionFilters({ browser: ['Firefox', 'Chrome'] });
    expect(filters.browser).toBe('Firefox');
  });
});

describe('withCursor', () => {
  it('keeps the active filters and appends the cursor', () => {
    const { form } = parseSessionFilters({ status: 'expired', hasErrors: 'true', route: '/a b' });
    expect(withCursor(form, 'abc==')).toBe('?status=expired&route=%2Fa+b&hasErrors=true&cursor=abc%3D%3D');
  });
});
