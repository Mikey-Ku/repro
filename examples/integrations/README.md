# SDK integration examples

Short, copyable examples of the foundational ways to wire `@repro/browser-sdk` into an application. Each file is an excerpt, not a project: paste it into your own app. The full option reference is in `packages/browser-sdk/README.md`; the guide is `docs/SDK.md`.

| File | Shows |
| --- | --- |
| `plain-script.html` | Script tag, masking attributes, a CSP that allows the ingest origin |
| `react-error-boundary.tsx` | Initialise once at module scope, report caught render errors, annotate steps |
| `nextjs-app-router.tsx` | A client component mounted in the root layout, key from `NEXT_PUBLIC_*` |
| `vue-plugin.ts` | A Vue plugin that hooks `app.config.errorHandler` |
| `record-on-incident.ts` | Buffer healthy sessions and upload only when something goes wrong |

Rules that apply to every framework:

1. Call `Repro.init` exactly once per page, before the application renders if possible, so the first snapshot includes the initial state.
2. Ingestion keys are write-only. Exposing one to the browser is expected; exposing the dashboard's internal token is not.
3. Mark anything the heuristics cannot know about with `data-repro-mask`, `data-repro-block` or `data-repro-ignore`.
4. Use opaque ids in `identify`; email-shaped ids are refused by the SDK.
