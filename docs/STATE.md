# State

Rewritten at the end of every slice. A resumed session reads
[BUILD-BRIEF.md](./BUILD-BRIEF.md) and this file, then continues from **Next action**.

## Current slice

**18 — packaging and the final report**

## Next action

Produce `release/dheys-cms-v1.0.0.zip` and `release/dheys-cms-v1.0.0.bundle`, excluding
`node_modules/`, `dist/` and `.git/` from the zip; unpack the zip into an empty directory,
install from the lockfile and run the whole gate there from scratch, so what ships is what
was proven rather than what happened to work in the build tree. Then write
`release/REPORT.md`.

The ship sequence beyond that is blocked — see **Blocked** below.

## Slices completed

- **1 — Skeleton, config, base-path handling, CI, clean-room gate, deploy pipeline.**
  Astro 5 + Preact + MDX + TypeScript strict; `astro.config.ts` shares `normaliseBase` with
  the runtime so build and markup cannot disagree; CI runs the gate on Node 20 and 22 with a
  separate root-hosting build job; nightly Windows/macOS matrix; the Pages deploy workflow
  reads its base path from `actions/configure-pages` rather than hard-coding it; clean-room
  gate written, tuned against a full-tree run, and proven by planted violations.
- **2 — Site registry, content schemas, content adapters.** `site-registry.ts` with the
  three runtime loaders (private gist, private companion repo, repository secret); the item
  schema with its eight required fields and the AI-provenance and affiliate-disclosure
  invariants; four content adapters, each asserted to emit output a consumer can actually
  load.
- **3–5 — Front end, SEO, feeds, both themes, search, admin shell.** `[...locale]` routes
  covering home, article, page, archive, category, author, search and 404; `SeoHead` with
  canonical URLs, `hreflang` and `NewsArticle` JSON-LD that credits no `Person` to
  AI-authored work; RSS, Atom, JSON Feed, news sitemap, `robots.txt`, `llms.txt`; the Dheys
  and Plain themes; Pagefind search; the admin shell as a single Preact island.
- **6–10 — Editorial machine, admin editor, review queue.** The transition map with
  actor-and-timestamp records; the Markdown editor with live field validation, slug-clash
  detection and Latin-punctuation-in-Thaana warnings; the review queue with per-rule
  guardrail results and a publish path that cannot be reached without human approval.
- **11–14 — Providers, scheduler, cost caps, automation workflows.** Anthropic, two
  OpenAI-shaped HTTP providers and a webhook provider, all behind one interface with an
  injected transport; the pure seeded-deterministic scheduler with catch-up and drip
  planning; per-job and per-site cost ceilings; the `agent-run` and `scheduler` workflows,
  which are the only place an AI key exists.
- **15–17 — End-to-end tests, performance gate, connector, documentation.** 44 Playwright
  tests against a real build with a mocked GitHub; the Lighthouse runner enforcing all four
  categories plus LCP, CLS and TBT on five pages; `pnpm connect-site`, verified against two
  fictional local targets; the full `docs/` set, the font slot, and the theme provenance
  note.

## Written but not yet wired into a page or workflow

Nothing. Every module is reachable from a page, a script or a workflow, and every one is
covered by tests.

## Gate status

Every row below was run and observed at the end of slice 17. Nothing here is inferred.

| Gate                             | Status                | Notes                                                              |
| -------------------------------- | --------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | pass                  | no warnings                                                        |
| `pnpm typecheck`                 | pass                  | `astro check`, 95 files: 0 errors, 0 warnings, 0 hints             |
| `pnpm lint`                      | pass                  | ESLint 9 flat config, `.ts`/`.tsx`/`.astro`, no warnings           |
| `pnpm test`                      | pass — 653 tests      | 19 files                                                           |
| `pnpm test:e2e`                  | pass — 44 tests       | real build, mocked GitHub, no network                              |
| `pnpm check:clean-room`          | pass                  | 181 files plus the full commit history                             |
| `pnpm build`                     | pass                  | warning-free; the Pagefind `dv` stemmer note is informational      |
| `pnpm check:links`               | pass — 648 references | both hosting modes; root mode run from PowerShell, see decision 38 |
| `pnpm lighthouse`                | pass                  | 100/100/100/100 on five pages; LCP ~910 ms, CLS 0.000, TBT 0 ms    |

## Open decisions affecting what comes next

- **DECISIONS.md #5** — bare hostnames are not scanned inside source files. If site
  configuration ever moves into a `.ts` file, that file must be added to the prose set or the
  configuration must stay in YAML/JSON.
- **DECISIONS.md #13 and #33** — only Anthropic model rates ship. Any other provider prices
  at the job ceiling until an operator sets a rate override on the site.
- **DECISIONS.md #29** — the Anthropic JSON Schema is maintained beside the Zod schema. A
  test asserts they agree on the required-field set; a field added to one must be added to
  the other.

## Blocked

- **Ship steps 2–6** (push, repository description and topics, Pages configuration, Actions
  secrets and variables, deploy, live-URL verification, the scratch-repo automation test) and
  the `v1.0.0` release. `gh` is installed (2.97.0) but unauthenticated, and `gh auth login`
  needs a browser and the operator's hands. This is the one stop the brief's preflight
  permits. Slices 1–18 are unaffected and complete. Recorded as OWNER-TODO 1.
- **Live-provider verification.** No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or
  `OPENAI_API_KEY` in the build environment. Per the brief's decision table, every provider
  is built and tested against mocks, none has been exercised against a live endpoint, and the
  report says so. Recorded as OWNER-TODO 5.

## Half-finished

Nothing.
