'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ExpectationSchema, RunTargetMode, type Expectation, type GenerateTestRequest } from '@repro/contracts';
import { ApiError, createKey, createRun, generateTest, getProjectBySlug, investigate, isUnreachable, patchIncident, revokeKey } from './api';
import { projectPath } from './paths';

/**
 * Server actions: the only way the browser mutates anything. Each one resolves
 * the project from its slug (so a form cannot target another project's id),
 * calls the internal API with the server-side token, then revalidates the page
 * that rendered the form so the new state streams back.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isUnreachable(error)) return 'The ingest service could not be reached.';
  return error instanceof Error ? error.message : 'Unexpected error';
}

const ExpectationsField = z.array(ExpectationSchema).max(5);

/** The expectation builder serialises its rows into one hidden JSON field. */
function parseExpectations(raw: FormDataEntryValue | null): Expectation[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const parsed = ExpectationsField.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error('Expectations are malformed.');
  return parsed.data;
}

function text(value: FormDataEntryValue | null, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

// Generated tests -------------------------------------------------------------

export async function generateTestAction(slug: string, sessionId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const project = await getProjectBySlug(slug);
    const body: GenerateTestRequest = {
      expectations: parseExpectations(formData.get('expectations')),
      testName: text(formData.get('testName'), 200),
      incidentId: text(formData.get('incidentId'), 100),
    };
    await generateTest(project.id, sessionId, body);
    revalidatePath(projectPath(slug, 'sessions', sessionId));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

// Reproduction runs -----------------------------------------------------------

export async function createRunAction(slug: string, sessionId: string, testId: string, formData: FormData): Promise<void> {
  const mode = RunTargetMode.parse(formData.get('mode') ?? 'broken');
  const project = await getProjectBySlug(slug);
  await createRun(project.id, testId, mode);
  revalidatePath(projectPath(slug, 'sessions', sessionId));
}

// Diagnostics -----------------------------------------------------------------

export async function investigateAction(slug: string, sessionId: string): Promise<void> {
  const project = await getProjectBySlug(slug);
  await investigate(project.id, sessionId);
  revalidatePath(projectPath(slug, 'sessions', sessionId));
}

// Incidents -------------------------------------------------------------------

export async function patchIncidentAction(slug: string, incidentId: string, formData: FormData): Promise<void> {
  const status = z.enum(['open', 'resolved']).parse(formData.get('status'));
  const project = await getProjectBySlug(slug);
  await patchIncident(project.id, incidentId, status);
  revalidatePath(projectPath(slug, 'incidents', incidentId));
  revalidatePath(projectPath(slug, 'incidents'));
  revalidatePath(projectPath(slug));
}

// Ingestion keys --------------------------------------------------------------

export interface CreatedKey {
  id: string;
  label: string;
  /** Plaintext key. Shown once, never stored by the dashboard. */
  key: string;
}

export async function createKeyAction(slug: string, _prev: ActionResult<CreatedKey> | null, formData: FormData): Promise<ActionResult<CreatedKey>> {
  const label = text(formData.get('label'), 100);
  if (!label) return { ok: false, message: 'Give the key a label.' };
  try {
    const project = await getProjectBySlug(slug);
    const created = await createKey(project.id, label);
    revalidatePath(projectPath(slug, 'settings'));
    return { ok: true, data: { id: created.id, label: created.label, key: created.key } };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function revokeKeyAction(slug: string, keyId: string): Promise<void> {
  const project = await getProjectBySlug(slug);
  await revokeKey(project.id, keyId);
  revalidatePath(projectPath(slug, 'settings'));
}
