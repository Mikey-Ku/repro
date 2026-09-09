import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config. Apps extend this and add framework rules.
 * @param {{ browser?: boolean; node?: boolean }} [env]
 */
export function repro(env = { node: true }) {
  return tseslint.config(
    { ignores: ['dist/**', '.next/**', 'node_modules/**', 'coverage/**', 'drizzle/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        globals: {
          ...(env.node ? globals.node : {}),
          ...(env.browser ? globals.browser : {}),
        },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
        'no-console': 'off',
      },
    },
    prettier,
  );
}

export default repro();
