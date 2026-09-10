import { repro } from '@repro/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...repro({ node: true, browser: true }),
  { ignores: ['.next/**', 'next-env.d.ts'] },
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
];
