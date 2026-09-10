/**
 * Allowlist check over the TypeScript syntax tree of a generated test.
 *
 * The regex denylist in validate.ts blocks known escape hatches. This pass takes the opposite
 * stance: nothing is allowed unless it is one of the node kinds, identifiers and member names
 * the generator (@repro/test-generator) is known to emit. An obfuscated route to the network
 * or the host (`window['fetch']`, `({}).constructor.constructor`, `page.request.get(...)`) is
 * rejected because the shape itself is unknown, not because a pattern recognised it.
 */
import ts from 'typescript';

export type AstResult = { ok: true } | { ok: false; reason: string };

/** Identifiers that may be referenced without being declared in the file. */
const ALLOWED_GLOBALS = new Set(['test', 'expect', 'String', 'URL', 'RegExp', 'process', 'HTMLFormElement']);

/** Member names that may appear after a dot. Anything else is unknown to the generator. */
const ALLOWED_MEMBERS = new Set([
  // Playwright page and locator API used by the generator
  'goto',
  'getByTestId',
  'getByRole',
  'getByLabel',
  'getByPlaceholder',
  'getByText',
  'locator',
  'on',
  'waitForResponse',
  'waitForLoadState',
  'click',
  'fill',
  'selectOption',
  'check',
  'uncheck',
  'press',
  'evaluate',
  // expect matchers
  'toBeVisible',
  'toHaveURL',
  'toEqual',
  'toBeTruthy',
  // response inspection inside the waitForResponse predicate
  'ok',
  'url',
  'request',
  'method',
  'pathname',
  // fixture helper and error collection
  'env',
  'replace',
  'toUpperCase',
  'push',
  // form submission fallback
  'requestSubmit',
]);

const ALLOWED_BINARY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const ALLOWED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamedImports,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.TypeReference,
  ts.SyntaxKind.ArrayType,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.AsyncKeyword,
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.SyntaxList,
  // Operator tokens are visited as children of BinaryExpression; the operator check restricts them.
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isTypeReferenceNode(parent) && parent.typeName === node)
  );
}

function collectDeclaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** Only `process.env[...]` and `process.env.X` may index; both must resolve to a fixture name. */
function isFixtureEnvAccess(node: ts.ElementAccessExpression | ts.PropertyAccessExpression): boolean {
  const target = node.expression;
  if (!ts.isPropertyAccessExpression(target)) return false;
  if (!ts.isIdentifier(target.expression) || target.expression.text !== 'process' || target.name.text !== 'env') return false;
  if (ts.isPropertyAccessExpression(node)) return node.name.text.startsWith('REPRO_FIXTURE_');
  const arg = node.argumentExpression;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text.startsWith('REPRO_FIXTURE_');
  if (ts.isTemplateExpression(arg)) return arg.head.text.startsWith('REPRO_FIXTURE_');
  return false;
}

export function checkAst(code: string): AstResult {
  const source = ts.createSourceFile('repro.spec.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) {
    const first = diagnostics[0]!;
    return { ok: false, reason: `Test code does not parse: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}` };
  }
  const declared = collectDeclaredNames(source);
  let failure: string | null = null;

  const describe = (node: ts.Node): string => {
    const text = node.getText(source).replace(/\s+/g, ' ');
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  };

  const visit = (node: ts.Node): void => {
    if (failure) return;
    if (!ALLOWED_KINDS.has(node.kind)) {
      failure = `Test code contains an unsupported construct (${ts.SyntaxKind[node.kind]}): ${describe(node)}`;
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (isMemberName) {
        if (!ALLOWED_MEMBERS.has(node.text) && !(ts.isPropertyAccessExpression(parent) && isFixtureEnvAccess(parent))) {
          failure = `Test code uses a member the generator never emits: .${node.text}`;
        }
      } else if (!isDeclarationName(node) && !declared.has(node.text) && !ALLOWED_GLOBALS.has(node.text)) {
        failure = `Test code references an unknown identifier: ${node.text}`;
      }
      return;
    }
    if (ts.isElementAccessExpression(node) && !isFixtureEnvAccess(node)) {
      failure = `Test code may only index process.env for REPRO_FIXTURE_* values (found ${describe(node)})`;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process') {
      if (node.name.text !== 'env') {
        failure = `Test code may only read process.env (found ${describe(node)})`;
        return;
      }
    }
    if (ts.isBinaryExpression(node) && !ALLOWED_BINARY_OPERATORS.has(node.operatorToken.kind)) {
      failure = `Test code uses an unsupported operator: ${node.operatorToken.getText(source)}`;
      return;
    }
    if (ts.isNewExpression(node)) {
      const callee = node.expression;
      if (!ts.isIdentifier(callee) || !['URL', 'RegExp'].includes(callee.text)) {
        failure = `Test code may only construct URL or RegExp (found ${describe(node)})`;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return failure ? { ok: false, reason: failure } : { ok: true };
}
