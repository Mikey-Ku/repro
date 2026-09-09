import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { commentText, regexEscape, stringLiteral } from '../src/index.js';

/** Parse `const x = <literal>;` and read the value back without evaluating anything. */
function roundTrip(literal: string): string {
  const file = ts.createSourceFile('x.ts', `const x = ${literal};`, ts.ScriptTarget.ES2022, true);
  const statement = file.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) throw new Error('not a variable statement');
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer || !ts.isStringLiteral(initializer)) throw new Error(`not a string literal: ${literal}`);
  return initializer.text;
}

const NASTY = [
  "'); require('child_process') //",
  'plain',
  '',
  'back\\slash',
  "it's",
  'say "hi"',
  '`template` with ${injection}',
  'line\nbreak\r\nand\ttab',
  'unicode \u2028 separator \u2029 paragraph',
  'null \u0000 byte and \u001b escape',
  'delete \u007f and c1 \u0085 control',
  'emoji 🙂 and accents é',
];

describe('stringLiteral', () => {
  it('round-trips every value through the TypeScript parser unchanged', () => {
    for (const value of NASTY) {
      const literal = stringLiteral(value);
      expect(literal.startsWith("'") && literal.endsWith("'"), value).toBe(true);
      expect(roundTrip(literal), value).toBe(value);
    }
  });

  it('keeps the literal on one physical line', () => {
    for (const value of NASTY) {
      expect(stringLiteral(value)).not.toMatch(/[\n\r\u2028\u2029]/);
    }
  });

  it('escapes the characters that matter and leaves the rest readable', () => {
    expect(stringLiteral("a'b")).toBe("'a\\'b'");
    expect(stringLiteral('a\\b')).toBe("'a\\\\b'");
    expect(stringLiteral('a\nb')).toBe("'a\\nb'");
    expect(stringLiteral('a\u2028b')).toBe("'a\\u2028b'");
    expect(stringLiteral('a\u0000b')).toBe("'a\\u0000b'");
    expect(stringLiteral('${x} `y` "z"')).toBe('\'${x} `y` "z"\'');
  });
});

describe('regexEscape', () => {
  it('makes a path match itself literally in a regex literal and in new RegExp', () => {
    const paths = ['/checkout', '/a.b/c+d?e=(1)[2]{3}|4^$', '/done/\'); process.exit(1); (\'', '/über/☃'];
    for (const path of paths) {
      const escaped = regexEscape(path);
      expect(new RegExp(escaped).test(path), path).toBe(true);
      expect(new RegExp(`^${escaped}$`).test(path), path).toBe(true);
      expect(new RegExp(escaped).test(`${path}x`), path).toBe(true);
      expect(escaped, path).not.toContain('\n');
    }
  });

  it('escapes the slash so the result can sit inside a regex literal', () => {
    expect(regexEscape('/a/b')).toBe('\\/a\\/b');
    expect(regexEscape('/a.b')).not.toMatch(/(^|[^\\])\.b/);
  });

  it('does not match a different path by accident', () => {
    expect(new RegExp(`^${regexEscape('/a.b')}$`).test('/aXb')).toBe(false);
    expect(new RegExp(`^${regexEscape('/x?y=1')}$`).test('/xy=1')).toBe(false);
  });
});

describe('commentText', () => {
  it('collapses whitespace and replaces control characters so a comment stays on one line', () => {
    expect(commentText('  a \n b\r\n\tc  ')).toBe('a b c');
    expect(commentText('a\u0000b')).toBe('a b');
    expect(commentText('a\u2028b\u2029c')).toBe('a b c');
    expect(commentText('*/ process.exit(1) /*')).toBe('*/ process.exit(1) /*');
  });
});
