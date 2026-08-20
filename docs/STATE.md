# State

Rewritten at the end of every slice. A resumed session reads
[BUILD-BRIEF.md](./BUILD-BRIEF.md) and this file, then continues from **Next action**.

## Current slice

**2 — Site registry, schemas, content adapters**

## Next action

Write `src/lib/site-registry.ts` (site definition schema + the three runtime loaders:
private gist, private companion repo, repository secret), then the four content adapters
under `src/lib/content-adapters/`, then `tests/unit/content-adapters.test.ts` asserting
each adapter emits output a consumer can actually load.

## Slices completed

- **1 — Skeleton, config, base-path handling, CI, clean-room gate, deploy pipeline.**
  Astro 5 + Preact + MDX + TypeScript strict; `astro.config.ts` shares `normaliseBase`
  with the runtime so build and markup cannot disagree; CI runs the gate on Node 20 and 22
  with a separate root-hosting build job; nightly Windows/macOS matrix; Pages deploy
  workflow reads its base path from `actions/configure-pages` rather than hard-coding it;
  clean-room gate written, tuned against a full-tree run, and proven by planted violations.

## Written but not yet wired into a page or workflow

These modules are complete, typechecked and (where noted) unit-tested. They have no UI or
runner in front of them yet — that arrives in the slice named.

| File | Covered by tests | Wired in slice |
|---|---|---|
| `src/lib/paths.ts` | yes — 38 cases, both hosting modes | 1 (done) |
| `scripts/clean-room.mjs` | yes — 27 cases including planted violations | 1 (done) |
| `src/lib/i18n.ts` | not yet | 5 |
| `src/lib/slug.ts` | not yet | 5 |
| `src/lib/schemas.ts` | not yet | 2 |
| `src/lib/editorial.ts` | not yet | 10 |
| `src/lib/job-contract.ts` | not yet | 12 |
| `src/lib/guardrails.ts` | not yet | 14 |
| `src/lib/scheduler.ts` | not yet | 11 |
| `src/lib/cost.ts` | not yet | 12 |

## Gate status

Last run at the end of slice 1.

| Gate | Status | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | clean after declaring `pnpm.onlyBuiltDependencies` for esbuild and sharp |
| `pnpm typecheck` | pass (`tsc --noEmit`) | `astro check` not yet meaningful — no `.astro` files exist |
| `pnpm lint` | not yet run | ESLint flat config written; first run due in slice 2 |
| `pnpm test` | pass — 65 tests | paths (38), clean-room (27) |
| `pnpm test:e2e` | not yet run | no pages to exercise until slice 3 |
| `pnpm check:clean-room` | pass | 35 files + full commit history, no violations |
| `pnpm build` | not yet run | needs at least one page; due in slice 3 |
| `pnpm check:links` | not yet written | slice 3 |
| `pnpm lighthouse` | not yet written | slice 6 |

## Open decisions affecting what comes next

- **DECISIONS.md #5** — bare hostnames are not scanned inside source files. If site
  configuration ever moves into a `.ts` file, that file must be added to the prose set or
  the config must stay in YAML/JSON.
- **DECISIONS.md #13** — only Anthropic model rates ship. The registry schema in slice 2
  needs a `modelRates` override field so an operator can price other providers.

## Blocked

- **Ship steps 2–6** (push, Pages configuration, Actions secrets, deploy, live
  verification, scratch-repo automation test). `gh` is installed (2.97.0) but
  unauthenticated, and `gh auth login` needs a browser and the operator's hands. Slices
  1–17 are unaffected. Recorded as OWNER-TODO 1.
- **Live-provider verification.** No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or
  `OPENAI_API_KEY` in the environment. Per the brief's decision table, all providers are
  built and tested against mocks and this is stated in the report.

## Half-finished

Nothing.
