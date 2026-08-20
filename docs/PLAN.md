# Build plan

The brief in [BUILD-BRIEF.md](./BUILD-BRIEF.md) sets the scope. This file is how it gets
built: the slice order, what "done" means for each, and what each slice may assume from
the ones before it. Progress against it lives in [STATE.md](./STATE.md); judgement calls
made along the way live in [DECISIONS.md](./DECISIONS.md).

## Shape of the system

Three layers, because a static host cannot run a scheduler or hold a key:

| Layer         | Runs on                                    | Owns                                                                                                                     |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Control plane | Static Astro build on GitHub Pages         | Admin UI, editor, review queue, calendar. Talks only to `api.github.com`. Holds no secret beyond a session-scoped token. |
| Automation    | GitHub Actions in this repository          | Scheduler, agent runner, deploy dispatch. Every AI key lives here, readable only inside a runner.                        |
| Content       | The user's own site repositories, any host | Markdown/MDX + media, committed by the automation layer or by the admin. Each site keeps its own build and deploy.       |

The admin never calls an AI provider. It dispatches a workflow and polls run status
through the GitHub API.

## Slice order

Each slice ends with the whole gate green, a commit, and STATE.md rewritten. A slice is
not done until `pnpm gate` passes on a clean tree.

| #   | Slice                                                             | Done when                                                                                                 |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Skeleton, config, base-path, CI, clean-room gate, deploy pipeline | Both hosting modes build; the clean-room gate is proven to fail on a planted violation                    |
| 2   | Site registry, schemas, content adapters                          | Every adapter emits output a consumer can actually load; registry loads from all three documented sources |
| 3   | Front-end rendering                                               | Home, article, archive, author, page, 404 render from collections                                         |
| 4   | SEO and feeds                                                     | Sitemaps, RSS/Atom/JSON Feed, JSON-LD, OG images, `robots.txt`, `llms.txt`                                |
| 5   | i18n, RTL, Dhivehi locale                                         | Three locales route, `dir`/`lang` correct, Thaana punctuation enforced                                    |
| 6   | Bare theme, then Dheys theme                                      | Both themes pass contrast in light and dark                                                               |
| 7   | Search                                                            | Pagefind index built and queryable per locale                                                             |
| 8   | Admin auth and read                                               | Token held in `sessionStorage` only; lists and detail views load through the GitHub API                   |
| 9   | Admin write and media                                             | Commit path works against a mocked API; media derivatives generated                                       |
| 10  | Editorial state machine and review queue                          | Every transition recorded with actor and timestamp; queue supports approve / request-changes / reject     |
| 11  | Scheduler and deploy adapters                                     | Idempotent ticks, missed-window catch-up, kill switch, five deploy adapters reporting real success        |
| 12  | Agent provider interface and one live provider                    | Contract enforced at intake; provider tested against a mock transport                                     |
| 13  | Commissions, triggers, automation                                 | Immediate, fixed, recurring and trigger-based timing                                                      |
| 14  | Guardrails                                                        | Affiliate disclosure blocks publication by default                                                        |
| 15  | Remaining providers                                               | Gemini, OpenAI, OpenAI-compatible, external webhook, bring-your-own                                       |
| 16  | Connector and `CONNECT-PROMPT.md`                                 | Route diff catches a deliberately dropped URL; migration report written                                   |
| 17  | Docs                                                              | Every file in the brief's deliverables list exists and is accurate                                        |
| 18  | Ship                                                              | Pushed, deployed, verified against the live URL, released                                                 |

## Rules that outrank convenience

- **No `any`.** Enforced by ESLint, not by review.
- **No credential anywhere in the tree or the history.** Enforced by the clean-room gate,
  which scans commit messages as well as files.
- **No test may reach a real AI provider or the real GitHub API.** E2E intercepts every
  outbound call.
- **Thresholds do not move.** If Lighthouse will not clear 95, the cause gets fixed or the
  feature gets removed.
- **Prefer deleting code to adding an option.**

## What is deliberately not in v1

Nothing yet. Anything that ends up here gets a line in DECISIONS.md explaining why, and a
row in the final report.
