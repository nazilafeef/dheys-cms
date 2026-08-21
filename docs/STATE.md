# State

Rewritten at the end of every slice. A resumed session reads
[BUILD-BRIEF.md](./BUILD-BRIEF.md) and this file, then continues from **Next action**.

## Current slice

**None. Slices 1–18 are complete, plus the operator's three amendments.** Everything that can
be done without a GitHub credential has been built and verified.

## Next action

Nothing further can be done from this side. Ship step 6 has now been run in full — see
`pnpm verify:automation` — and step 5 cannot run because nothing is deployed. The next action
belongs to the operator:

```
gh auth login -h github.com -s repo,workflow,admin:repo_hook -w
```

Then ship steps 2–7 in `docs/BUILD-BRIEF.md` §13, in order: push and set the repository
description and topics; enable Pages with the source set to GitHub Actions and set the Actions
secrets and variables; trigger the deploy and poll it; verify against the live URL rather than
localhost; verify the automation end to end against one scratch repository and then delete it;
and attach `release/dheys-cms-v1.0.0.zip` and `release/dheys-cms-v1.0.0.bundle` to a `v1.0.0`
release.

`release/REPORT.md` records what has and has not been verified, and
`release/OWNER-TODO.md` lists the six things that need the operator's own hands.

## Slices completed

- **1 — Skeleton, config, base-path handling, CI, clean-room gate, deploy pipeline.**
  Astro 5 + Preact + MDX + TypeScript strict; `astro.config.ts` shares `normaliseBase` with
  the runtime so build and markup cannot disagree; CI runs the gate on Node 20 and 22 with a
  separate root-hosting build job; nightly Windows/macOS matrix; the Pages deploy workflow
  reads its base path from `actions/configure-pages` rather than hard-coding it; clean-room
  gate written, tuned against a full-tree run, and proven by planted violations.
- **2 — Site registry, content schemas, content adapters.** `site-registry.ts` with the three
  runtime loaders (private gist, private companion repo, repository secret); the item schema
  with its eight required fields and the AI-provenance and affiliate-disclosure invariants;
  four content adapters, each asserted to emit output a consumer can actually load.
- **3–5 — Front end, SEO, feeds, both themes, search, admin shell.** `[...locale]` routes
  covering home, article, page, archive, category, author, search and 404; `SeoHead` with
  canonical URLs, `hreflang` and `NewsArticle` JSON-LD that credits no `Person` to AI-authored
  work; RSS, Atom, JSON Feed, news sitemap, `robots.txt`, `llms.txt`; the Dheys and Plain
  themes; Pagefind search; the admin shell as a single Preact island.
- **6–10 — Editorial machine, admin editor, review queue.** The transition map with
  actor-and-timestamp records; the Markdown editor with live field validation, slug-clash
  detection and Latin-punctuation-in-Thaana warnings; the review queue with per-rule guardrail
  results and a publish path that cannot be reached without human approval.
- **11–14 — Providers, scheduler, cost caps, automation workflows.** Anthropic, two
  OpenAI-shaped HTTP providers and a webhook provider, all behind one interface with an
  injected transport; the pure seeded-deterministic scheduler with catch-up and drip planning;
  per-job and per-site cost ceilings; the `agent-run` and `scheduler` workflows, which are the
  only place an AI key exists.
- **15–17 — End-to-end tests, performance gate, connector, documentation.** 44 Playwright
  tests against a real build with a mocked GitHub; the Lighthouse runner enforcing all four
  categories plus LCP, CLS and TBT on five pages; `pnpm connect-site`, verified against two
  fictional local targets; the full `docs/` set, the font slot, and the theme provenance note.
- **Amendments — the public/private split, bundle verification, provider-free step 6.**
  This repository's Actions secret store stays empty for good; the operator runs a private
  instance holding every key and the registry, documented in `README.md`,
  `docs/installation.md` and OWNER-TODO 7. The release archive is verified by cloning the
  bundle rather than unzipping the zip, so the clean-room gate reads the shipped history and
  proves it by marker commit (DECISIONS 46, resolved). Ship step 6 runs against a local
  stand-in with no provider configured: kill switch, a real scheduler run, two guardrail
  blocks, idempotency, the connector's route diff and migration report, and a refused
  migration that would have lost a URL.
- **18 — Packaging and the report.** `release/dheys-cms-v1.0.0.zip` (182 files, exactly the
  tracked set, no `node_modules/`, `dist/` or `.git/`) and `release/dheys-cms-v1.0.0.bundle`
  (all refs). The archive was unpacked into an empty directory and the whole gate run there
  from scratch, every stage exiting 0. `release/REPORT.md` in the brief's nine sections, with
  the raw timestamped log as an appendix.

## Written but not yet wired into a page or workflow

Nothing. Every module is reachable from a page, a script or a workflow, and every one is
covered by tests.

## Gate status

Every row was run against a **clone of the release bundle**, not this tree, and observed.
Nothing here is inferred. Raw logs in `release/REPORT.md`, Appendices A and B. Run both with
`pnpm verify:release` and `pnpm verify:automation`.

| Gate                             | Status                | Notes                                                              |
| -------------------------------- | --------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | pass                  | no warnings                                                        |
| `pnpm typecheck`                 | pass                  | `astro check`, 95 files: 0 errors, 0 warnings, 0 hints             |
| `pnpm lint`                      | pass                  | ESLint 9 flat config plus a Prettier format check                  |
| `pnpm test`                      | pass — 658 tests      | 20 files, 0 skipped, 0 todo                                        |
| `pnpm test:e2e`                  | pass — 44 tests       | real build, mocked GitHub, no network                              |
| `pnpm check:clean-room`          | pass                  | 185 files plus every commit message                                |
| `pnpm build`                     | pass                  | warning-free; the Pagefind `dv` stemmer note is informational      |
| `pnpm check:links`               | pass — 648 references | both hosting modes; root mode run from PowerShell, see decision 38 |
| `pnpm lighthouse`                | pass                  | 100/100/100/100 on five pages; LCP 907 ms, CLS 0.000, TBT 0 ms     |

Article-page JS is 2.8 KB (en) and 3.0 KB (ar), all inline, against a 30 KB budget.

## Open decisions affecting what comes next

- **DECISIONS.md #5** — bare hostnames are not scanned inside source files. If site
  configuration ever moves into a `.ts` file, that file must be added to the prose set or the
  configuration must stay in YAML/JSON.
- **DECISIONS.md #13 and #33** — only Anthropic model rates ship. Any other provider prices at
  the job ceiling until an operator sets a rate override on the site.
- **DECISIONS.md #29** — the Anthropic JSON Schema is maintained beside the Zod schema. A test
  asserts they agree on the required-field set; a field added to one must be added to the
  other.
- **DECISIONS.md #46** — the archive is verified inside a gitignored path in this working
  directory, so git-aware checks resolve to this repository. Relevant to anyone re-running the
  packaging verification.

## Blocked

- **Ship steps 2, 3, 4, 5 and 7** and the `v1.0.0` GitHub release. Step 6 is done. `gh` is installed (2.97.0) but
  unauthenticated, and `gh auth login` needs a browser and the operator's hands. This is the
  one stop the brief's preflight permits. Recorded as OWNER-TODO 1.
- **Live-provider verification, which happens elsewhere by design.** No AI provider has ever
  been called and no key was read from the environment at any point. Every provider is built
  and tested against mock transports. This is not a gap to close here: keys live on the
  operator's private instance, so that is where a live call belongs. OWNER-TODO 5 and 7.

## Half-finished

Nothing.
