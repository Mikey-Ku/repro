/**
 * Helpers that turn recorded text into TypeScript source safely.
 *
 * Recorded sessions contain text typed by strangers on the internet. Every piece of it
 * that lands in generated code goes through one of these functions, so there is no path
 * by which recorded text can close a string literal, end a comment or otherwise become code.
 */

const hex4 = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;

/** Code units that must never appear raw inside a literal or a line comment. */
const isControl = (code: number): boolean =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;

/**
 * A single-quoted TypeScript string literal for `value`.
 * Backslashes, quotes, line terminators (including U+2028 and U+2029, which are legal in
 * JSON but historically not in JS source) and other control characters are escaped.
 * Backticks and `${` are inert inside single quotes, so they pass through unchanged.
 */
export function stringLiteral(value: string): string {
  let body = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (ch === '\\') body += '\\\\';
    else if (ch === "'") body += "\\'";
    else if (ch === '\n') body += '\\n';
    else if (ch === '\r') body += '\\r';
    else if (ch === '\t') body += '\\t';
    else if (isControl(code)) body += hex4(code);
    else body += ch;
  }
  return `'${body}'`;
}

const REGEX_SPECIALS = new Set(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/']);

/**
 * Escape `value` so it matches itself literally inside a regular expression.
 * `/` is escaped too so the result can be used in a regex literal as well as in `new RegExp`.
 */
export function regexEscape(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (REGEX_SPECIALS.has(ch)) out += `\\${ch}`;
    else if (isControl(code) || code > 0x7e) out += hex4(code);
    else out += ch;
  }
  return out;
}

/**
 * Text that is safe to place after `//`. Line terminators would otherwise end the comment
 * and turn the rest of the recorded text into code.
 */
export function commentText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += isControl(code) ? ' ' : value.charAt(i);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** A double-quoted CSS attribute value: `[name="..."]`. */
export function cssAttributeValue(value: string): string {
  let body = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (ch === '\\') body += '\\\\';
    else if (ch === '"') body += '\\"';
    else if (isControl(code)) body += `\\${code.toString(16)} `;
    else body += ch;
  }
  return `"${body}"`;
}

/** True when `value` can follow `#` in a CSS selector without any escaping. */
export function isPlainCssIdentifier(value: string): boolean {
  return /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(value) && !value.startsWith('--');
}
