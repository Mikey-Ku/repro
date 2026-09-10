/**
 * The SDK snippet shown on the overview and settings pages. Pure string
 * builders so both server pages render the same text.
 */
export function sdkSnippet(projectKey: string, endpoint: string): string {
  return [
    "import { Repro } from '@repro/browser-sdk';",
    '',
    'Repro.init({',
    `  projectKey: '${projectKey}',`,
    `  endpoint: '${endpoint}',`,
    "  release: '1.0.0',",
    '});',
  ].join('\n');
}

export function scriptTagSnippet(projectKey: string, endpoint: string): string {
  return [
    '<script src="/vendor/repro.iife.js"></script>',
    '<script>',
    `  Repro.init({ projectKey: '${projectKey}', endpoint: '${endpoint}' });`,
    '</script>',
  ].join('\n');
}
