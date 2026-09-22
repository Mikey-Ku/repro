import {
  DiagnosticFindingSchema,
  GeneratedTestSchema,
  IncidentSchema,
  IngestionKeySchema,
  ProjectSchema,
  ReproductionRunSchema,
  SessionSummarySchema,
} from '@repro/contracts';
import type { FindingRow, GeneratedTestRow, IncidentRow, IngestionKeyRow, ProjectRow, RunRow, SessionRow } from '@repro/db';
import { describe, expect, it } from 'vitest';
import {
  toFindingDto,
  toGeneratedTestDto,
  toIncidentDto,
  toIngestionKeyDto,
  toProjectDto,
  toRunDto,
  toSessionDto,
} from '../../src/mappers.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const at = new Date('2024-05-01T10:00:00.000Z');
const later = new Date('2024-05-01T10:01:30.500Z');

const project: ProjectRow = {
  id: PROJECT,
  slug: 'demo',
  name: 'Demo',
  retentionDays: 30,
  runTargets: [{ id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'external' }],
  createdAt: at,
  updatedAt: at,
};

const key: IngestionKeyRow = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: PROJECT,
  label: 'Demo application',
  prefix: 'rp_abcdefgh',
  keyHash: 'deadbeef',
  lastUsedAt: null,
  revokedAt: later,
  createdAt: at,
};

const session: SessionRow = {
  id: SESSION,
  projectId: PROJECT,
  status: 'completed',
  startedAt: at,
  endedAt: later,
  lastSeenAt: later,
  release: 'v1',
  environment: null,
  browserName: 'Chrome',
  browserVersion: '130',
  os: 'macOS',
  userAgent: 'UA',
  viewportWidth: 1280,
  viewportHeight: 720,
  initialUrl: 'http://localhost:4100/login',
  initialRoute: '/login',
  routes: ['/login', '/checkout/:id'],
  errorCount: 1,
  networkFailureCount: 0,
  eventCount: 12,
  chunkCount: 2,
  lastSeq: 11,
  sdkVersion: '0.1.0',
  externalUserId: null,
  meta: {},
  createdAt: at,
  updatedAt: later,
};

describe('mappers produce DTOs that satisfy the contracts schemas', () => {
  it('project and ingestion key', () => {
    const dto = toProjectDto(project);
    expect(ProjectSchema.parse(dto)).toEqual(dto);
    expect(dto.createdAt).toBe('2024-05-01T10:00:00.000Z');
    expect(dto.runTargets).toEqual([{ id: 'a1b2c3d4', name: 'Staging', url: 'https://staging.example.com', kind: 'external' }]);

    const keyDto = toIngestionKeyDto(key);
    expect(IngestionKeySchema.parse(keyDto)).toEqual(keyDto);
    expect(keyDto.revokedAt).toBe(later.toISOString());
    expect(keyDto.lastUsedAt).toBeNull();
    expect(keyDto).not.toHaveProperty('keyHash');
  });

  it('session, with duration derived from start and end', () => {
    const dto = toSessionDto(session);
    expect(SessionSummarySchema.parse(dto)).toEqual(dto);
    expect(dto.durationMs).toBe(90_500);
    expect(dto).not.toHaveProperty('userAgent');

    const open = toSessionDto({ ...session, status: 'recording', endedAt: null });
    expect(open.durationMs).toBeNull();
    expect(open.endedAt).toBeNull();
  });

  it('incident', () => {
    const row: IncidentRow = {
      id: '44444444-4444-4444-8444-444444444444',
      projectId: PROJECT,
      sessionId: SESSION,
      kind: 'exception',
      title: 'TypeError: x',
      message: 'x is undefined',
      fingerprint: 'fp',
      firstSeq: 5,
      firstTs: at,
      offsetMs: 500,
      route: '/checkout/:id',
      release: 'v1',
      status: 'open',
      createdAt: at,
      updatedAt: at,
    };
    const dto = toIncidentDto(row);
    expect(IncidentSchema.parse(dto)).toEqual(dto);
    expect(dto.firstTs).toBe(at.toISOString());
  });

  it('generated test', () => {
    const row: GeneratedTestRow = {
      id: '55555555-5555-4555-8555-555555555555',
      projectId: PROJECT,
      sessionId: SESSION,
      incidentId: null,
      version: 2,
      name: '/login: click "Pay" completes',
      code: 'test("x", async () => {});',
      language: 'typescript',
      framework: 'playwright',
      sourceHash: 'abc',
      generatorVersion: '0.1.0',
      selectors: [{ seq: 1, action: 'click "Pay"', strategy: 'role', selector: "getByRole('button', { name: 'Pay' })" }],
      omitted: [{ seq: 2, type: 'submit', reason: 'implied' }],
      warnings: ['w'],
      expectations: [{ kind: 'url', pathPrefix: '/done' }],
      createdAt: at,
    };
    const dto = toGeneratedTestDto(row);
    expect(GeneratedTestSchema.parse(dto)).toEqual(dto);
  });

  it('run, dropping artifact paths', () => {
    const row: RunRow = {
      id: '66666666-6666-4666-8666-666666666666',
      projectId: PROJECT,
      sessionId: SESSION,
      generatedTestId: '55555555-5555-4555-8555-555555555555',
      status: 'passed',
      target: 'demo',
      targetMode: 'fixed',
      targetUrl: null,
      targetName: null,
      queuedAt: at,
      startedAt: at,
      finishedAt: later,
      durationMs: 90_500,
      failureMessage: null,
      logs: 'ok',
      exitCode: 0,
      artifacts: [{ name: 'screenshot.png', contentType: 'image/png', bytes: 10, path: '/var/secret/screenshot.png' }],
    };
    const dto = toRunDto(row);
    expect(ReproductionRunSchema.parse(dto)).toEqual(dto);
    expect(dto.artifacts).toEqual([{ name: 'screenshot.png', contentType: 'image/png', bytes: 10 }]);
    expect(JSON.stringify(dto)).not.toContain('/var/secret');
    expect(dto).toMatchObject({ targetMode: 'fixed', targetName: null, targetUrl: null });

    // An external run stores 'none' as its mode and keeps the target snapshot; an unknown mode reads as broken.
    const external = toRunDto({ ...row, target: 'a1b2c3d4', targetMode: 'none', targetName: 'Staging', targetUrl: 'https://staging.example.com' });
    expect(ReproductionRunSchema.parse(external)).toMatchObject({ target: 'a1b2c3d4', targetMode: 'none', targetName: 'Staging', targetUrl: 'https://staging.example.com' });
    expect(toRunDto({ ...row, targetMode: 'sideways' }).targetMode).toBe('broken');
  });

  it('finding', () => {
    const row: FindingRow = {
      id: '77777777-7777-4777-8777-777777777777',
      projectId: PROJECT,
      sessionId: SESSION,
      incidentId: null,
      kind: 'investigation',
      provider: 'fake',
      model: 'rules-v1',
      evidence: null,
      investigation: {
        provider: 'fake',
        model: 'rules-v1',
        hypothesis: null,
        confidence: 'none',
        abstained: true,
        abstainReason: 'nothing',
        evidence: [],
        inferences: [],
        suggestedChecks: [],
      },
      createdAt: at,
    };
    const dto = toFindingDto(row);
    expect(DiagnosticFindingSchema.parse(dto)).toEqual(dto);
  });
});
