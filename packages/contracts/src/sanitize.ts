/**
 * Pure redaction helpers. These run inside the browser SDK before anything leaves the page,
 * and again on the server as defence in depth. They must not depend on DOM APIs.
 */

const SENSITIVE_PARAM_PATTERN =
  /(^|[_\-.])?(token|secret|password|passwd|pwd|auth|authorization|session|sid|sessionid|api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt|bearer|credential|credentials|signature|sig|otp|code|key|private|client[_-]?secret|csrf|xsrf|nonce)([_\-.]|$)/i;

/** Query-string or fragment parameter names that are dropped from captured URLs. */
export function isSensitiveParamName(name: string): boolean {
  return SENSITIVE_PARAM_PATTERN.test(name.trim());
}

/** Substrings that are unambiguous wherever they appear inside a hint. */
const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'cvv',
  'cvc',
  'cvn',
  'iban',
  'swift',
  'passport',
  'mnemonic',
  'seedphrase',
  'seed_phrase',
  'seed-phrase',
  'privatekey',
  'private_key',
  'private-key',
  'socialsecurity',
  'social_security',
  'social-security',
  'securitycode',
  'security_code',
  'security-code',
  'cardnumber',
  'card_number',
  'card-number',
  'creditcard',
  'credit_card',
  'credit-card',
  'accountnumber',
  'account_number',
  'account-number',
  'routingnumber',
  'routing_number',
  'routing-number',
  'taxid',
  'tax_id',
  'tax-id',
  'onetimecode',
  'one_time_code',
  'one-time-code',
];

/** Whole-token words. These are too short to match as substrings ("pin" is inside "shipping"). */
const SENSITIVE_TOKENS = new Set([
  'pwd',
  'pass',
  'auth',
  'session',
  'ssn',
  'card',
  'credit',
  'debit',
  'pan',
  'bic',
  'routing',
  'acct',
  'pin',
  'otp',
  'csc',
  'key',
  'sid',
  'expiry',
  'expiration',
  'license',
  'licence',
  'verification',
]);

function tokenize(hint: string): string[] {
  return hint
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when an element name, id, label, placeholder or autocomplete hints at a secret. */
export function isSensitiveFieldHint(hint: string | null | undefined): boolean {
  if (!hint) return false;
  const lower = hint.toLowerCase();
  if (SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  const tokens = tokenize(hint);
  if (tokens.some((t) => SENSITIVE_TOKENS.has(t))) return true;
  // Two-word combinations such as "card no", "account num", "security question".
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const pair = `${tokens[i]}${tokens[i + 1]}`;
    if (SENSITIVE_SUBSTRINGS.includes(pair)) return true;
    if (['no', 'num', 'number'].includes(tokens[i + 1] ?? '') && ['card', 'account', 'routing', 'acct'].includes(tokens[i] ?? '')) return true;
  }
  return false;
}

const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-given-name',
  'cc-family-name',
  'cc-type',
]);

export function isSensitiveAutocomplete(value: string | null | undefined): boolean {
  if (!value) return false;
  return value
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SENSITIVE_AUTOCOMPLETE.has(token));
}

const SENSITIVE_INPUT_TYPES = new Set(['password', 'hidden']);

export interface FieldSensitivityInput {
  tag?: string | null;
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  placeholder?: string | null;
  label?: string | null;
  ariaLabel?: string | null;
  /** Any explicit opt-in mask marker such as data-repro-mask. */
  explicitMask?: boolean;
  /** Strict mode masks every text-bearing input. */
  strict?: boolean;
}

/**
 * Decide whether the value of a form control must be masked.
 * The decision is deliberately biased towards masking: any hint wins.
 */
export function isSensitiveField(input: FieldSensitivityInput): boolean {
  if (input.explicitMask) return true;
  const type = (input.type ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  if (isSensitiveAutocomplete(input.autocomplete)) return true;
  if (input.strict) {
    // In strict mode, only controls that cannot carry free text stay visible.
    const tag = (input.tag ?? '').toLowerCase();
    const freeText =
      tag === 'textarea' ||
      (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'reset', 'range'].includes(type));
    if (freeText) return true;
  }
  return [input.name, input.id, input.placeholder, input.label, input.ariaLabel].some((hint) =>
    isSensitiveFieldHint(hint),
  );
}

export const REDACTED = '[redacted]';

/**
 * Remove sensitive query-string and fragment parameters from a URL.
 * Relative URLs are resolved against `base` when provided, otherwise returned path-only.
 */
export function sanitizeUrl(rawUrl: string, base?: string): string {
  if (!rawUrl) return '';
  let url: URL;
  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    // Not parseable as an absolute URL. Strip everything after ? or # to be safe.
    return rawUrl.split(/[?#]/)[0] ?? '';
  }
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
  }
  const params = new URLSearchParams(url.search);
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    kept.append(key, isSensitiveParamName(key) ? REDACTED : value);
  }
  const search = kept.toString();
  url.search = search ? `?${search}` : '';
  if (url.hash) {
    const fragment = url.hash.slice(1);
    if (fragment.includes('=')) {
      const fragParams = new URLSearchParams(fragment);
      const keptFrag = new URLSearchParams();
      for (const [key, value] of fragParams) {
        keptFrag.append(key, isSensitiveParamName(key) ? REDACTED : value);
      }
      url.hash = `#${keptFrag.toString()}`;
    }
  }
  return url.toString();
}

/** Path plus sanitised query, without origin. Used for routes and network paths. */
export function sanitizePath(rawUrl: string, base?: string): string {
  const sanitized = sanitizeUrl(rawUrl, base ?? 'http://relative.invalid');
  try {
    const url = new URL(sanitized);
    return `${url.pathname}${url.search}`;
  } catch {
    return sanitized;
  }
}

/** Route template: the path with numeric or uuid-like segments replaced by `:id`. */
export function routeFromPath(path: string): string {
  const pathname = path.split('?')[0] ?? path;
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ':id';
      return segment;
    })
    .join('/');
}

const HEADER_DENYLIST = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

/** Headers that must never be captured. The SDK does not capture headers at all; this documents the rule. */
export function isDeniedHeader(name: string): boolean {
  return HEADER_DENYLIST.has(name.toLowerCase());
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Best-effort scrub of secret-looking substrings inside free text (error messages, console args).
 * This is a safety net, not the primary control: the primary control is not capturing secrets.
 */
const INLINE_SECRET_PATTERNS: RegExp[] = [
  /\b(bearer|basic)\s+[a-z0-9\-._~+/]+=*/gi,
  /\b(sk|pk|rk|ak)_(live|test|prod)_[a-z0-9]{8,}/gi,
  /\b(sk|pk)-[a-z0-9]{20,}/gi,
  /\bgh[pousr]_[a-z0-9]{20,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/gi,
  /\b(?:\d[ -]?){13,19}\b/g,
  /((?:token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|cookie|session)[a-z0-9_-]*\s*[:=]\s*["']?)[^\s"'&;,]+/gi,
];

export function scrubText(text: string): string {
  let out = text;
  for (const pattern of INLINE_SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...groups) => {
      const prefix = typeof groups[0] === 'string' && /[:=]\s*["']?$/.test(groups[0]) ? groups[0] : '';
      if (prefix) return `${prefix}${REDACTED}`;
      // For bearer/basic keep the scheme so the shape of the error stays readable.
      const scheme = /^(bearer|basic)\s/i.exec(match);
      return scheme ? `${scheme[1]} ${REDACTED}` : REDACTED;
    });
  }
  return out;
}
