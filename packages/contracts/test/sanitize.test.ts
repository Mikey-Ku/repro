import { describe, expect, it } from 'vitest';
import {
  isSensitiveField,
  isSensitiveParamName,
  routeFromPath,
  sanitizePath,
  sanitizeUrl,
  scrubText,
} from '../src/index.js';

describe('sanitizeUrl', () => {
  it('redacts sensitive query parameters and keeps harmless ones', () => {
    const out = sanitizeUrl('https://shop.example/checkout?ref=email&token=CANARY_QS_TOKEN&page=2');
    expect(out).toBe('https://shop.example/checkout?ref=email&token=%5Bredacted%5D&page=2');
    expect(out).not.toContain('CANARY');
  });

  it('redacts fragment parameters such as implicit OAuth tokens', () => {
    const out = sanitizeUrl('https://app.example/callback#access_token=CANARY_FRAG&state=abc');
    expect(out).not.toContain('CANARY_FRAG');
    expect(out).toContain('state=abc');
  });

  it('strips basic-auth credentials from the URL', () => {
    expect(sanitizeUrl('https://user:CANARY_PW@host.example/path')).toBe('https://host.example/path');
  });

  it('handles relative URLs with a base', () => {
    expect(sanitizePath('/api/orders?apiKey=CANARY&limit=5', 'http://localhost:4100')).toBe(
      '/api/orders?apiKey=%5Bredacted%5D&limit=5',
    );
  });

  it('is safe on garbage input', () => {
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl('not a url?secret=CANARY')).toBe('not a url');
  });
});

describe('isSensitiveParamName', () => {
  it.each(['token', 'access_token', 'api-key', 'apikey', 'sessionId', 'sid', 'code', 'password', 'x-auth', 'refreshToken', 'jwt'])(
    'flags %s',
    (name) => expect(isSensitiveParamName(name)).toBe(true),
  );
  it.each(['page', 'ref', 'q', 'sort', 'limit', 'utm_source'])('allows %s', (name) =>
    expect(isSensitiveParamName(name)).toBe(false),
  );
});

describe('isSensitiveField', () => {
  it('masks password inputs regardless of name', () => {
    expect(isSensitiveField({ tag: 'input', type: 'password', name: 'harmless' })).toBe(true);
  });
  it('masks payment fields by name, label, placeholder and autocomplete', () => {
    expect(isSensitiveField({ tag: 'input', name: 'cardNumber' })).toBe(true);
    expect(isSensitiveField({ tag: 'input', label: 'CVC' })).toBe(true);
    expect(isSensitiveField({ tag: 'input', placeholder: 'Card number' })).toBe(true);
    expect(isSensitiveField({ tag: 'input', autocomplete: 'cc-number' })).toBe(true);
    expect(isSensitiveField({ tag: 'input', id: 'expiry', autocomplete: 'cc-exp' })).toBe(true);
  });
  it('masks secrets, tokens, auth, cookies and api keys', () => {
    for (const name of ['secret', 'api_key', 'apiKey', 'authToken', 'cookie', 'session', 'ssn', 'pin']) {
      expect(isSensitiveField({ tag: 'input', name }), name).toBe(true);
    }
  });
  it('masks hidden inputs', () => {
    expect(isSensitiveField({ tag: 'input', type: 'hidden', name: 'csrf' })).toBe(true);
  });
  it('leaves ordinary fields visible by default', () => {
    expect(isSensitiveField({ tag: 'input', name: 'fullName', label: 'Full name' })).toBe(false);
    expect(isSensitiveField({ tag: 'input', type: 'email', name: 'email' })).toBe(false);
    expect(isSensitiveField({ tag: 'select', name: 'shipping' })).toBe(false);
  });
  it('strict mode masks all free-text inputs but not checkboxes or selects', () => {
    expect(isSensitiveField({ tag: 'input', name: 'fullName', strict: true })).toBe(true);
    expect(isSensitiveField({ tag: 'textarea', name: 'notes', strict: true })).toBe(true);
    expect(isSensitiveField({ tag: 'input', type: 'checkbox', name: 'save', strict: true })).toBe(false);
    expect(isSensitiveField({ tag: 'select', name: 'shipping', strict: true })).toBe(false);
  });
});

describe('scrubText', () => {
  it('redacts bearer tokens, key-shaped strings, jwts and card numbers inside messages', () => {
    const msg =
      'Request failed: Authorization: Bearer CANARY_BEARER_abc123 key=ak_prod_CANARYKEY1234 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c card 4242 4242 4242 4242 password=CANARY_PW';
    const out = scrubText(msg);
    for (const canary of ['CANARY_BEARER', 'CANARYKEY', 'eyJhbGciOiJIUzI1NiJ9', '4242 4242', 'CANARY_PW']) {
      expect(out).not.toContain(canary);
    }
    expect(out).toContain('Request failed');
  });
});

describe('routeFromPath', () => {
  it('templates ids', () => {
    expect(routeFromPath('/orders/12345/items/3f1c2a7e-1b2c-4d5e-8f90-abcdef123456?x=1')).toBe('/orders/:id/items/:id');
    expect(routeFromPath('/checkout')).toBe('/checkout');
  });
});
