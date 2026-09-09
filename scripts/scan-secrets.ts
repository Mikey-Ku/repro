/**
 * Secret scanner for the repository and its committed fixtures.
 *
 * Two jobs:
 * 1. Fail on anything that looks like a real credential in tracked files.
 * 2. Fail if a demo canary value appears outside the files that are allowed to contain it
 *    (the demo app, tests and docs). Recorded fixtures must never contain a canary.
 *
 * Run with: pnpm secrets:scan
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const credentialPatterns: { name: string; pattern: RegExp }[] = [
  { name: 'private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Stripe live key', pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI key', pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/ },
];

/** Files allowed to contain demo canary values because they define or assert on them. */
const canaryAllowlist = [
  /^apps\/demo\//,
  /^tests\/e2e\//,
  /^packages\/browser-sdk\/test\//,
  /^packages\/browser-sdk\/README\.md$/,
  /^packages\/contracts\/test\//,
  /^packages\/diagnostics\/test\//,
  /^packages\/test-generator\/test\//,
  /^apps\/ingest\/test\//,
  /^apps\/worker\/test\//,
  /^apps\/web\/src\/.*\.test\.tsx?$/,
  /^scripts\//,
  /^docs\//,
  /^README\.md$/,
];

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('node_modules/') && !f.startsWith('dist/') && !f.includes('/dist/') && !f.includes('.next/'))
    .filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico|zip|woff2?|ttf|lock)$/i.test(f) && f !== 'pnpm-lock.yaml');
}

function main(): void {
  const canaryFile = path.join(repoRoot, 'apps', 'demo', 'canaries.json');
  const canaries: string[] = fs.existsSync(canaryFile) ? Object.values(JSON.parse(fs.readFileSync(canaryFile, 'utf8')) as Record<string, string>) : [];
  const findings: string[] = [];
  const files = trackedFiles();

  for (const file of files) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (file !== 'scripts/scan-secrets.ts') {
      for (const { name, pattern } of credentialPatterns) {
        if (pattern.test(text)) findings.push(`${file}: matches ${name}`);
      }
    }
    if (file === '.env.example') {
      for (const line of text.split('\n')) {
        const match = /^([A-Z0-9_]+)=(.+)$/.exec(line.trim());
        if (!match) continue;
        const [, key, value] = match;
        const placeholder = /^(change-me|<|\$\{|placeholder|xxx|your-)/i.test(value!) || /^postgres:\/\/repro:repro@/.test(value!);
        if (/(KEY|TOKEN|SECRET|PASSWORD)/.test(key!) && value && !placeholder) {
          findings.push(`.env.example: ${key} has a non-placeholder value`);
        }
      }
    }
    const allowed = canaryAllowlist.some((re) => re.test(file));
    if (!allowed) {
      for (const canary of canaries) {
        if (text.includes(canary)) findings.push(`${file}: contains demo canary ${canary.slice(0, 24)}...`);
      }
      if (/CANARY_[A-Z_]+/.test(text)) findings.push(`${file}: contains a CANARY_ marker outside the allowlist`);
    }
  }

  if (findings.length) {
    console.error('Secret scan failed:');
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Secret scan clean (${files.length} files, ${canaries.length} canaries checked).`);
}

main();
