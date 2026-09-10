import type {
  DiagnosticFinding,
  EvidenceSummary,
  Expectation,
  GeneratedTest,
  Incident,
  IncidentGroup,
  IngestionKey,
  Investigation,
  Project,
  ReproductionRun,
  SessionSummary,
} from '@repro/contracts';
import type { FindingRow, GeneratedTestRow, IncidentRow, IngestionKeyRow, ProjectRow, RunRow, SessionRow } from '@repro/db';
import type { IncidentGroupRow } from './services/incidents.js';

/**
 * Database rows to API DTOs. The rules are simple and the same everywhere: dates become ISO
 * strings, nullable dates become null, and columns that exist only for storage (key hashes,
 * artifact paths, user agents) never leave this module.
 */

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toProjectDto(row: ProjectRow): Project {
  return { id: row.id, slug: row.slug, name: row.name, retentionDays: row.retentionDays, createdAt: iso(row.createdAt) };
}

export function toIngestionKeyDto(row: IngestionKeyRow): IngestionKey {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    prefix: row.prefix,
    createdAt: iso(row.createdAt),
    revokedAt: isoOrNull(row.revokedAt),
    lastUsedAt: isoOrNull(row.lastUsedAt),
  };
}

export function toSessionDto(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    lastSeenAt: iso(row.lastSeenAt),
    durationMs: row.endedAt ? Math.max(0, row.endedAt.getTime() - row.startedAt.getTime()) : null,
    release: row.release,
    environment: row.environment,
    browserName: row.browserName,
    browserVersion: row.browserVersion,
    os: row.os,
    initialUrl: row.initialUrl,
    initialRoute: row.initialRoute,
    routes: row.routes,
    errorCount: row.errorCount,
    networkFailureCount: row.networkFailureCount,
    eventCount: row.eventCount,
    chunkCount: row.chunkCount,
    externalUserId: row.externalUserId,
    sdkVersion: row.sdkVersion,
    viewportWidth: row.viewportWidth,
    viewportHeight: row.viewportHeight,
  };
}

export function toIncidentDto(row: IncidentRow): Incident {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    kind: row.kind,
    title: row.title,
    message: row.message,
    fingerprint: row.fingerprint,
    firstSeq: row.firstSeq,
    firstTs: iso(row.firstTs),
    offsetMs: row.offsetMs,
    route: row.route,
    release: row.release,
    status: row.status,
    createdAt: iso(row.createdAt),
  };
}

export function toIncidentGroupDto(row: IncidentGroupRow): IncidentGroup {
  return {
    fingerprint: row.fingerprint,
    kind: row.kind,
    title: row.title,
    message: row.message,
    sessionCount: row.sessionCount,
    firstSeen: iso(row.firstSeen),
    lastSeen: iso(row.lastSeen),
    releases: row.releases,
    routes: row.routes,
    openCount: row.openCount,
    latestIncidentId: row.latestIncidentId,
    latestSessionId: row.latestSessionId,
  };
}

export function toGeneratedTestDto(row: GeneratedTestRow): GeneratedTest {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    incidentId: row.incidentId,
    version: row.version,
    name: row.name,
    code: row.code,
    // The schema stores these as free text so other generators can be added later; the only
    // writer today is the Playwright generator, so the literals in the contract hold.
    language: 'typescript',
    framework: 'playwright',
    sourceHash: row.sourceHash,
    generatorVersion: row.generatorVersion,
    selectors: row.selectors as GeneratedTest['selectors'],
    omitted: row.omitted as GeneratedTest['omitted'],
    warnings: row.warnings,
    expectations: row.expectations as Expectation[],
    createdAt: iso(row.createdAt),
  };
}

export function toRunDto(row: RunRow): ReproductionRun {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    generatedTestId: row.generatedTestId,
    status: row.status,
    target: row.target,
    targetMode: row.targetMode === 'fixed' ? 'fixed' : 'broken',
    queuedAt: iso(row.queuedAt),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    durationMs: row.durationMs,
    failureMessage: row.failureMessage,
    logs: row.logs,
    exitCode: row.exitCode,
    // The filesystem path stays server-side; clients fetch artifacts by name.
    artifacts: row.artifacts.map(({ name, contentType, bytes }) => ({ name, contentType, bytes })),
  };
}

export function toFindingDto(row: FindingRow): DiagnosticFinding {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    incidentId: row.incidentId,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    evidence: (row.evidence as EvidenceSummary | null) ?? null,
    investigation: (row.investigation as Investigation | null) ?? null,
    createdAt: iso(row.createdAt),
  };
}
