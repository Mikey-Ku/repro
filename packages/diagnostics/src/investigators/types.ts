import type { EvidenceSummary, Investigation, TimelineEntry } from '@repro/contracts';

export interface InvestigatorInput {
  summary: EvidenceSummary;
  timeline: TimelineEntry[];
}

/** Something that turns evidence into a hypothesis. Fake (rules) or AI (model behind a gateway). */
export interface Investigator {
  readonly provider: string;
  readonly model: string;
  investigate(input: InvestigatorInput): Promise<Investigation>;
}
