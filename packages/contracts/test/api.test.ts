import { describe, expect, it } from 'vitest';
import { CreateRunRequestSchema, RunTargetInputSchema, RunTargetSchema, runTargetOrigin } from '../src/index.js';

describe('runTargetOrigin', () => {
  it('accepts http and https origins and normalises them', () => {
    expect(runTargetOrigin('http://localhost:4100')).toBe('http://localhost:4100');
    expect(runTargetOrigin('http://localhost:4100/')).toBe('http://localhost:4100');
    expect(runTargetOrigin('  HTTPS://Staging.Example.com:8443/ ')).toBe('https://staging.example.com:8443');
    expect(runTargetOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(runTargetOrigin('http://10.0.0.5')).toBe('http://10.0.0.5');
  });

  it('refuses anything that is not a bare http(s) origin', () => {
    const rejected = [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://example.com',
      'data:text/html,hi',
      'example.com',
      '//example.com',
      'http://',
      'http://example.com/app',
      'http://example.com/app/',
      'http://example.com?x=1',
      'http://example.com/#frag',
      'http://user:pass@example.com',
      'http://user@example.com',
      '',
      'not a url',
    ];
    for (const value of rejected) expect(runTargetOrigin(value), value).toBeNull();
  });
});

describe('run target schemas', () => {
  it('validates input and stored targets with the same url rule', () => {
    expect(RunTargetInputSchema.safeParse({ name: ' Staging ', url: 'https://staging.example.com' })).toMatchObject({
      success: true,
      data: { name: 'Staging', url: 'https://staging.example.com' },
    });
    expect(RunTargetInputSchema.safeParse({ name: '', url: 'https://staging.example.com' }).success).toBe(false);
    expect(RunTargetInputSchema.safeParse({ name: 'x', url: 'https://staging.example.com/login' }).success).toBe(false);
    expect(RunTargetSchema.safeParse({ id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'external' }).success).toBe(true);
    expect(RunTargetSchema.safeParse({ id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'demo' }).success).toBe(false);
  });

  it('defaults a run request to the demo target with no mode set', () => {
    expect(CreateRunRequestSchema.parse({})).toEqual({ targetId: 'demo' });
    expect(CreateRunRequestSchema.parse({ mode: 'fixed' })).toEqual({ targetId: 'demo', mode: 'fixed' });
    expect(CreateRunRequestSchema.parse({ targetId: 'a1b2c3d4' })).toEqual({ targetId: 'a1b2c3d4' });
    expect(CreateRunRequestSchema.safeParse({ mode: 'sideways' }).success).toBe(false);
    expect(CreateRunRequestSchema.safeParse({ targetId: '' }).success).toBe(false);
  });
});
