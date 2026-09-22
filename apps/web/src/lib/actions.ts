'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ExpectationSchema, RunTargetInputSchema, type CreateRunRequest, type Expectation, type GenerateTestRequest } from '@repro/contracts';
import { ApiError, addTarget, createKey, createRun, generateTest, getProjectBySlug, investigate, isUnreachable, patchIncident, removeTarget, revokeKey } from './api';
import { parseRunTargetChoice } from './run-target';
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

/** The Runs tab posts one `target` field (see RunTargetSelect); the ingest API resolves the id against the project. */
export async function createRunAction(slug: string, sessionId: string, testId: string, formData: FormData): Promise<void> {
  const body: CreateRunRequest = parseRunTargetChoice(formData.get('target'));
  const project = await getProjectBySlug(slug);
  await createRun(project.id, testId, body);
  revalidatePath(projectPath(slug, 'sessions', sessionId));
}

// Reproduction targets ---------------------------------------------------------

export async function addTargetAction(slug: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const input = RunTargetInputSchema.safeParse({ name: formData.get('name') ?? '', url: formData.get('url') ?? '' });
  if (!input.success) {
    const urlIssue = input.error.issues.find((issue) => issue.path[0] === 'url');
    return { ok: false, message: urlIssue ? `URL ${urlIssue.message}.` : 'Give the target a name.' };
  }
  try {
    const project = await getProjectBySlug(slug);
    await addTarget(project.id, input.data);
    revalidatePath(projectPath(slug, 'settings'));
    return { ok: true, message: `Target "${input.data.name}" added.` };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function removeTargetAction(slug: string, targetId: string): Promise<void> {
  const project = await getProjectBySlug(slug);
  await removeTarget(project.id, targetId);
  revalidatePath(projectPath(slug, 'settings'));
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
