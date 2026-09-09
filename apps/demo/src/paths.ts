import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from both src/ (tsx in dev) and dist/ (tsup build) because they are siblings.
export const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const publicDir = path.join(demoRoot, 'public');
export const sdkBundlePath = path.join(demoRoot, 'node_modules/@repro/browser-sdk/dist/repro.iife.js');
