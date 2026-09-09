import type { Expectation, OmittedEvent, RecordedEvent } from '@repro/contracts';
import type { SelectorStrategy } from './selectors.js';

export interface GeneratorInput {
  session: {
    id: string;
    projectSlug: string;
    startedAt: number;
    initialUrl: string;
    release?: string | null;
    browser?: string | null;
    dashboardUrl?: string | null;
  };
  events: RecordedEvent[];
  /** Extra success-state expectations. `no-errors` is always applied even when absent. */
  expectations?: Expectation[];
  testName?: string;
  incident?: { id: string; title: string; message: string } | null;
}

export interface SelectorReportEntry {
  seq: number;
  /** Human-readable description of the recorded action, for example `fill "Card number"`. */
  action: string;
  strategy: SelectorStrategy;
  /** The locator expression that was emitted, empty when the strategy is `none`. */
  selector: string;
  note?: string;
}

export interface GeneratorOutput {
  code: string;
  name: string;
  sourceHash: string;
  generatorVersion: string;
  selectors: SelectorReportEntry[];
  omitted: OmittedEvent[];
  warnings: string[];
}
