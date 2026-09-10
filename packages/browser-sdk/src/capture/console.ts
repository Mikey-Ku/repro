/**
 * console.error and console.warn capture. The original method always runs first so the
 * developer tools output is unchanged; we only observe the arguments.
 */
import { LIMITS } from '@repro/contracts';
import { formatConsoleArg } from '../redact.js';
import type { CaptureContext, Stop } from '../types.js';

const LEVELS = ['error', 'warn'] as const;
type Level = (typeof LEVELS)[number];

export function startConsole(ctx: CaptureContext): Stop {
  const originals: Partial<Record<Level, (...args: unknown[]) => void>> = {};
  let inside = false;

  for (const level of LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    originals[level] = original;
    console[level] = (...args: unknown[]) => {
      original.apply(console, args);
      // Guard against a stringifier that logs (for example a getter that warns) recursing forever.
      if (inside) return;
      inside = true;
      try {
        ctx.emit({
          type: 'console',
          data: { level, args: args.slice(0, LIMITS.maxConsoleArgs).map(formatConsoleArg) },
        });
      } catch (err) {
        ctx.debug('console capture failed', err);
      } finally {
        inside = false;
      }
    };
  }

  return () => {
    for (const level of LEVELS) {
      const original = originals[level];
      if (original) console[level] = original;
    }
  };
}
