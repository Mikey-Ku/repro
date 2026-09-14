import type { FastifyInstance } from 'fastify';
import { extractDomMarkers, type ExpectationSuggestionsResponse } from '@repro/contracts';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { validationFailed } from '../errors.js';
import { toReferenceCandidateDto } from '../mappers.js';
import { loadSessionEvents } from '../services/events.js';
import { NO_REFERENCE_NOTE, listReferenceCandidates, suggestFromReference } from '../services/suggestions.js';
import { idParam, parseWith, requireProject, requireSession } from './shared.js';

type SessionParams = { Params: { projectId: string; sessionId: string }; Querystring: Record<string, string | undefined> };

const SuggestionsQuery = z.object({ reference: z.string().max(100).optional() });

export function registerSuggestionRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Passing sessions on the same route, newest first, that can act as the reference. */
  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/reference-candidates', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const rows = await listReferenceCandidates(ctx.db, project.id, session);
    return rows.map(toReferenceCandidateDto);
  });

  /**
   * What appeared only in the reference session. Without a reference the answer is the heuristic
   * list, which is empty because `no-errors` is always applied by the generator anyway.
   */
  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/expectation-suggestions', async (request): Promise<ExpectationSuggestionsResponse> => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const { reference } = parseWith(SuggestionsQuery, request.query, 'Suggestion query');
    if (!reference) return { suggestions: [], reference: null, note: NO_REFERENCE_NOTE };

    // A reference outside this project is a 404 like any other cross-project id, never a 403.
    const referenceSession = await requireSession(ctx, project.id, idParam(reference, 'Reference session'));
    if (referenceSession.id === session.id) throw validationFailed('The reference must be a different session');

    const [failingEvents, referenceEvents] = await Promise.all([loadSessionEvents(ctx.db, session.id), loadSessionEvents(ctx.db, referenceSession.id)]);
    const suggestions = suggestFromReference(extractDomMarkers(failingEvents), extractDomMarkers(referenceEvents));
    return { suggestions, reference: referenceSession.id };
  });
}
