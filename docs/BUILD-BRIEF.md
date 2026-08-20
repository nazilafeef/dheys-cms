# Dheys CMS — Build Brief

This is the brief the project was built to, reproduced so that a resumed session, a
contributor, or a reader auditing the final report can check the product against what was
actually asked for. It is a historical document: where the build departed from it, the
departure is recorded in [DECISIONS.md](./DECISIONS.md), not by editing this file.

---

## 1. MANDATE

Sole engineer and release manager for **Dheys CMS**, a free open-source multi-site content
platform: architecture, implementation, security review, testing, documentation,
publishing and verification.

### Fixed location

|                   |                                               |
| ----------------- | --------------------------------------------- |
| Working directory | `D:\2026\dheys-cms`                           |
| Remote            | `https://github.com/nazilafeef/dheys-cms.git` |
| Visibility        | public                                        |
| Live URL          | `https://nazilafeef.github.io/dheys-cms/`     |

No scratch clones, sibling directories or working copies elsewhere. No reading from or
writing to any other repository on the machine.

### Rule 1 — no questions

Do not ask the operator a question, request confirmation, or pause for approval. When
something is unresolved: check the decision table; otherwise choose what best serves a
first-time end user and write one line in `docs/DECISIONS.md`; if it will later need the
operator's hand, implement a working fallback now and add a numbered entry to
`release/OWNER-TODO.md`. Only the preflight in section 13 Step 0 may stop the build.

### Rule 2 — clean room

Nothing committed may connect the repository to the operator's own websites, businesses,
accounts or other repositories. Forbidden in every committed file — including docs, tests,
examples, comments, commit messages and demo content:

- any domain the operator owns or operates
- any GitHub repository reference other than `nazilafeef/dheys-cms`
- any account id, project id, deployment id, token, hostname or dashboard reference for
  any third-party service
- any real site, client or company name
- any content copied from an existing site

Demo content, examples, tests and screenshots use invented sites only — `example-news`,
`demo-journal`, `sample-shop`. The site registry ships as `sites.example.ts` with
fictional entries and nothing else.

Enforced with a gate: `scripts/check-clean-room.mjs`, wired to `pnpm check:clean-room` and
run in CI, failing the build on a fully-qualified domain outside a short allowlist held in
one file, a foreign `github.com/<owner>/<repo>` reference, or anything matching a
credential shape. Proven by planting a violation in a test and asserting the gate fails.

### Rule 3 — verify, never assert

Never report something as working without having run the command and seen it pass. If a
command fails, fix it and re-run. "Known issue" is not an available outcome.

---

## 2. PRE-RESOLVED DECISIONS

| Situation                                    | What to do                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Dheys logo file is absent                | Text wordmark placeholder in the display face, build warning naming `src/assets/brand/dheys-logo.svg`, OWNER-TODO entry. Never draw a substitute logo.           |
| Brand colours, type scale or spacing needed  | Use the tokens in section 9. They are the specification.                                                                                                         |
| Font licensing unresolved                    | Ship no font binary in this repo, ever. Use the font slot in section 9 and a permissively-licensed fallback. State the open question plainly in `docs/FONTS.md`. |
| Curiosity about an existing agent system     | Do not read another repository. Build to the job contract in section 5.                                                                                          |
| No AI key in the environment                 | Build all providers, test against mocks, skip live-provider verification, say so in the report.                                                                  |
| A library's licence is incompatible with MIT | Do not use it.                                                                                                                                                   |
| A Lighthouse threshold is not reachable      | Fix the cause. If the cause is a feature, remove or defer the feature. Never lower the threshold.                                                                |
| Two requirements conflict                    | Pick the reading that serves a first-time end user, log it, continue.                                                                                            |
| A dependency has a known CVE                 | Upgrade or replace.                                                                                                                                              |
| A test is flaky                              | Fix the flakiness. Never skip, never `.todo`, never retry to hide it.                                                                                            |
| Example data needed                          | Invent a fictional site.                                                                                                                                         |
| Context running low                          | Follow section 12 immediately.                                                                                                                                   |
| The remote already holds substantive content | Preflight failure. Stop.                                                                                                                                         |
| Scope feels too large                        | Follow the slice order in section 11 and keep going.                                                                                                             |

---

## 3. MISSION AND ARCHITECTURE

Dheys CMS manages content for many websites from one deployment, on any host. It handles
articles written by humans and by AI agents in a single editorial pipeline, with
configurable approval gates and fully automated scheduling. The control plane runs on
GitHub Pages with no server, no database and no paid hosting.

Three audiences: the **operator**, who commissions, reviews, schedules and publishes
across every connected site from one screen; the **connector**, who points Claude Code at
an existing website with one short prompt and has it migrated with no manual steps; and the
**public forker**, who clones, runs one install and one dev command, has everything pass
first try, and finds nothing tying the project to anyone in particular.

### The static-hosting problem and its answer

A static site cannot run a scheduler, hold AI keys, or orchestrate agents. No client-side
timers, no browser-held keys. Three layers:

| Layer         | Where                              | Responsibility                                                                                                                     |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Control plane | Static Astro app on GitHub Pages   | Admin UI, editor, review queue, registry, calendar. Talks only to `api.github.com`. Holds no secret beyond a session-scoped token. |
| Automation    | GitHub Actions in this repo        | Scheduler and agent runner. Cron, `workflow_dispatch`, `repository_dispatch`. All AI keys in Actions secrets.                      |
| Content       | The user's site repos, on any host | Markdown/MDX + media, committed by the automation layer or the admin.                                                              |

The admin never calls an AI provider directly. It dispatches a workflow and polls run
status through the GitHub API.

### Stack

Astro (latest stable), `output: 'static'`, TypeScript `strict`. Admin is a Preact island,
not a separate SPA build. Content is Markdown/MDX with YAML frontmatter — never bare JSON
fragments, because brace-less JSON that a CMS re-wraps on read breaks any consumer
importing the file as real JSON. Zod validates frontmatter. Auth is a GitHub fine-grained
PAT scoped to the connected repos, held in `sessionStorage` only, with an optional
documented GitHub App path. The admin must never require `unsafe-eval` — no JSON-Schema
validator that compiles schemas at runtime. Search is Pagefind. pnpm, Node pinned in
`.nvmrc` and `engines`. MIT licence.

Hard bans: no database, no required backend, no paid service in the default path, no
telemetry, no AI key reachable from a browser, no `any`, no committed secret, no real site
configuration in the repo.

The live URL is a project sub-path, `/dheys-cms/`. Base-path resolution must be correct for
both sub-path and root hosting and covered by a test in slice 1.

---

## 4. MULTI-SITE AND THE ONE-PROMPT CONNECTOR

**Site registry.** A site definition holds id, display name, GitHub repo, default branch,
content directory, locales, theme, content schemas, publishing rules, agent configuration,
deploy adapter and guardrails. The registry never lives in this repo — it loads at runtime
from a private gist, a private companion repo, or a repository secret. All three documented
in `docs/site-registry.md` using fictional examples.

**Deploy adapters.** A `DeployAdapter` interface with working implementations for GitHub
Pages, Cloudflare Pages, Netlify, Vercel and a generic webhook. Each must trigger a deploy
and report whether it succeeded.

**Content adapters.** A `ContentAdapter` projects Markdown+frontmatter into whatever the
target consumes at build time. Four ship: Astro/Next content collections (direct); a
JSON-consuming SPA (a complete, valid JSON array — not a fragment — so a module importing
it with `with { type: 'json' }` works); a JS data module; and generic (writes Markdown to a
directory and runs a user-supplied transform).

**The connector**, a v1 deliverable. `scripts/connect-site.mjs`, a non-interactive CLI that
clones a target repo into a temp directory it creates and removes; analyses framework,
build command, output directory, host, content locations, existing CMS, routing, locales
and sitemap; infers the content model and emits Zod schemas; migrates all existing content
**including content outside any current CMS such as hardcoded data modules**; selects and
wires the right adapters; removes any previous CMS cleanly, leaving no dead endpoints and
no orphaned CSP entries; adds the site to the registry; runs the target's own build and
test suite and proves every existing URL still resolves with a before/after route diff that
fails if any live URL is lost; and writes `MIGRATION-REPORT.md` into the target repo.

Then `docs/CONNECT-PROMPT.md`: a short prompt template with a placeholder for the target
repo and no real site in it.

**Guardrails.** Declarative per-site rules that block publication: required fields, banned
phrases, minimum word count, required disclosure, human-review-required, locale
completeness. A failure produces a plain-language error naming site, item and rule. One
rule ships in the default set: any content item containing an affiliate offer must
auto-render a disclosure and cannot publish without one, enforced in the schema rather than
the UI.

**Cross-site features.** Unified dashboard and review queue, per-site permissions,
move/copy between sites with schema remapping, per-site media library, per-site analytics
adapters, bulk scheduling.

---

## 5. AI CONNECTIVITY AND AGENTS

**Providers.** One `AgentProvider` interface, all implementations opt-in. Direct API
providers: Anthropic, Gemini, OpenAI, plus a generic OpenAI-compatible endpoint for
self-hosted models, keys in Actions secrets and used only in runners. An external-agent
adapter that dispatches a job to an existing pipeline by webhook and reads the result back.
And bring-your-own: the same contract, JSON in and Markdown+frontmatter out.

**The job contract, enforced strictly.** Every agent-produced item must arrive with valid,
complete frontmatter. Required and non-negotiable: `title`, `slug`, `category`,
`publishedDate`, `excerpt`, `locale`, `author`, `sourceType`. An item missing any is
rejected at intake with a named-field error, never written to a site repo, and shown in the
review queue as a failed job. Missing `category` and `publishedDate` are a common
real-world failure of agent output.

Every AI-authored item also carries provenance: model, prompt version, sources with URLs,
token counts, cost, run id, timestamps — stored in frontmatter and rendered as an
attribution line the theme can display or suppress. Never publish AI content claiming a
human author. Publish the contract as a JSON Schema in `docs/agent-job-contract.md` with a
worked fictional example.

**Job types.** `research`, `write`, `rewrite`, `translate` (locale to locale, preserving
frontmatter, handling RTL), `seo-optimise`, `fact-check`, `image-alt`. Jobs compose into
chains.

**Cost control, mandatory.** Per-site and global monthly caps enforced before dispatch.
Live cost display in the admin. Hard stop at the cap with an explicit override action. Log
every run's real token count and cost. Long generations run as background workflows with
status polling.

---

## 6. EDITORIAL AUTOMATION

```
idea → commissioned → researching → drafting → draft
     → in-review → approved → scheduled → published
                 → changes-requested → drafting
                 → rejected
```

Every transition records actor (human username or agent run id) and timestamp in
frontmatter. Git history is the audit trail.

**Commissioning.** A commission holds brief, target site, locale(s), content type, agent
chain and run timing. Timing supports immediate, fixed datetime, recurring cron, and
trigger-based — an RSS feed matching a filter, or a keyword appearing in a monitored
source. Commissions are files in the registry storage, versioned and reviewable.

**Approval policy, per commission.** `human-required` never publishes without explicit
human approval and is the default. `human-optional` enters the queue with a deadline; a
human decision governs, and if the deadline lapses with no action it auto-publishes. `auto`
publishes on schedule with no human step — guardrails still apply and still block. The
review queue supports one-screen diff review, inline editing before approval, approve,
request-changes with a note that feeds a rewrite job, and reject with reason.

**Publish timing.** Fixed datetime, timezone-aware, with a configurable default timezone.
Randomised within a window — "between 08:00 and 11:00 Thursday" — seeded per item so it is
deterministic and testable. Drip scheduling across a date range. Embargo until a datetime
even if approved earlier.

**The scheduler** is a cron GitHub Action. Each tick reads the queue, promotes what is due,
commits to the target repo and triggers that site's deploy adapter. Cron runners are
delayed under load: never assume exact-minute firing, make every tick idempotent, never
double-publish, and publish a missed window late rather than skipping it silently. A single
repository variable is the kill switch, halting all automated publishing across all sites
without a redeploy.

---

## 7. WEB REQUIREMENTS

**Content model.** Post, page, author, category, tag, series, plus a registry so a custom
type needs one schema file. Draft/scheduled/published, featured, pinned, canonical
override, SEO overrides, noindex.

**Admin UI.** Cross-site dashboard; review queue; list views with search, filter and sort;
editor with split live preview, Markdown toolbar and drag-drop image paste; media library
with responsive derivatives; slug generation with collision detection; SEO panel with live
social preview and character counters; commission builder; schedule calendar; agent run
history with cost; unsaved-changes guard; full keyboard operation; works on mobile.

**Front end.** Home, article, archive, author, page, search, 404. Under 30 KB of JavaScript
on an article page. Reading time, table of contents, prev/next, build-time related posts,
share links with no third-party scripts, dark/light via `prefers-color-scheme` with no
flash, ad slots that make no network call when unfilled.

**SEO.** `sitemap.xml`, news sitemap, RSS 2.0, Atom, JSON Feed, `robots.txt`, `llms.txt`,
canonical tags, OpenGraph, Twitter cards, JSON-LD (`NewsArticle`, `BreadcrumbList`,
`Organization`, `WebSite` with SearchAction), build-time OG images, `.nojekyll`, real
`404.html`.

**i18n and RTL, first class.** Multi-locale routing, per-locale collections, `hreflang`,
logical CSS properties throughout (`margin-inline-start`, never `margin-left`), correct
`dir` and `lang`, mirrored icons and navigation, and an RTL-correct admin UI. Ship working
Dhivehi (`dv`, Thaana, RTL), English, and Arabic as a second RTL check. Thaana-safe slug
transliteration. Thaana punctuation (`U+060C`, `U+061B`, `U+061F`) in Dhivehi content,
never Latin commas. All UI strings in locale JSON — no hardcoded English in components.
Translation jobs round-trip frontmatter without corruption.

**Accessibility and performance, enforced in CI.** WCAG 2.2 AA. Lighthouse all four
categories >= 95, LCP < 2.0s, CLS < 0.05, TBT < 150ms, zero console errors or warnings on
any page. Build fails on breach.

---

## 8. SECURITY

No AI key, PAT or credential in any committed file at any point in history; `.env.example`
only. Set security headers in the response of every serverless function added — header
config files that apply to static assets do not apply to functions. If any OAuth popup flow
exists, complete the full handshake: popup announces, opener echoes, opener origin
validated against an allowlist, and only then post the token. Never render sign-in
vocabulary or branding on an OAuth callback page. Verify configuration values, not response
shapes; a 302 proves nothing about whether a credential is valid. `docs/SECURITY.md` states
the token-storage model and its trade-offs honestly.

---

## 9. THEME, LOGO, FONT

Two themes ship. **Bare** is neutral and unbranded and is the default for a fresh install.
**Dheys** is this project's branded theme.

**Dheys tokens — this is the specification, defined here and nowhere else.** Restrained
editorial character: deep ink on warm paper, one accent used sparingly, no gradients, no
shadows beyond a single subtle elevation step.

```
--ink-900: #14120E        /* body text, headings */
--ink-600: #4A463D        /* secondary text */
--ink-400: #7C7668        /* meta, captions */
--paper:   #FBFAF6        /* page background, warm off-white */
--surface: #F3F1EA        /* cards, wells */
--rule:    #DFDBD0        /* hairlines, borders */
--accent:  #1F4D46        /* deep muted green; links, active states */
--accent-hover: #163A34
--focus:   #B4531F        /* focus ring; must never be the accent */
```

Dark theme inverts to a warm near-black ground, not pure black, keeping the same accent hue
at raised lightness. Every pairing clears 4.5:1 in both themes, proven by the accessibility
test. Type scale 1.25 from a 17px base. Spacing in 4px steps. Border radius 2px only.
Measure capped at 68 characters for Latin body text, 62 for Thaana. Record in
`docs/THEME-PROVENANCE.md` that these tokens are the project's own specification.

**Logo.** Expected at `src/assets/brand/dheys-logo.svg`, supplied by the operator. Missing
means a text wordmark placeholder, a build warning naming the path and an OWNER-TODO entry.
Never draw a substitute.

**Font.** The Thaana typeface intended for this project derives from a font carrying a bare
all-rights-reserved notice with no EULA, and one build variant merges an OFL-licensed face,
which would trigger OFL clause 5 across the whole file. The basis for derivative use is
unresolved, so **ship no font binary in this repo**. Instead implement a font slot: the
theme references a Thaana webfont by config path under a documented metric contract —
original letter and word spacing preserved exactly, `unicode-range` covering `U+0020` and
`U+00A0` so the space glyph is not taken from the Latin face, `font-display: swap`,
preload, `font-synthesis: none`. Ship a permissively-licensed Thaana fallback, or none plus
a documented setup step. Provide `scripts/link-font.mjs` pointing a local install at font
files the operator keeps outside the repo, writing a gitignored path. State the licensing
position and the open question plainly in `docs/FONTS.md`.

---

## 10. QUALITY GATES

Every one must pass on a clean clone:

```bash
pnpm install --frozen-lockfile   # no warnings, no peer conflicts
pnpm typecheck                   # astro check + tsc --noEmit, zero errors
pnpm lint                        # eslint + prettier --check, zero warnings
pnpm test                        # vitest, all pass
pnpm test:e2e                    # playwright; GitHub API and AI providers MOCKED
pnpm check:clean-room            # no domain, repo reference or credential leaks
pnpm build                       # zero errors, zero warnings
pnpm preview                     # serves, no console errors
pnpm lighthouse                  # all four >= 95
pnpm check:links                 # no broken internal links
```

CI runs the full gate on Node 20 and 22 on ubuntu for every push; the windows and macOS
matrix runs nightly.

Tests must cover: schema validation failures by name; the job contract rejecting items
missing `category` or `publishedDate`; base-path resolution in both hosting modes; draft
and future-dated exclusion from output; scheduler idempotency and missed-window catch-up;
randomised publish determinism under a fixed seed; guardrail blocking including the
affiliate disclosure rule; approval-deadline auto-publish; cost-cap enforcement before
dispatch; RTL rendering and Thaana punctuation; translation frontmatter round-trip; feed
and sitemap shape; the admin commit path; each content adapter emitting valid consumable
output; the connector's route diff catching a deliberately dropped URL; and the clean-room
gate failing on a planted violation.

No test may call a real AI provider or the real GitHub API.

---

## 11. BUILD ORDER

Vertical slices, each ending with the whole gate green.

1. Skeleton, config, base-path handling, CI, clean-room gate, deploy pipeline
2. Site registry, schemas, content adapters
3. Front-end rendering
4. SEO and feeds
5. i18n, RTL, Dhivehi locale
6. Bare theme, then Dheys theme
7. Search
8. Admin auth and read
9. Admin write and media
10. Editorial state machine and review queue
11. Scheduler and deploy adapters
12. Agent provider interface and one live provider
13. Commissions, triggers, automation
14. Guardrails
15. Remaining providers
16. Connector and `CONNECT-PROMPT.md`
17. Docs
18. Ship sequence

Prefer deleting code over adding options. Audit dependencies before slice 17.

---

## 12. SESSION CONTINUITY

Maintain `docs/STATE.md`, rewritten at the end of every slice and whenever context runs
low. It contains only: current slice number and name; slices completed; the exact next
action; every gate's last-run status; open DECISIONS.md items affecting what comes next;
and anything half-finished, named by file.

---

## 13. SHIP SEQUENCE

**Step 0 — preflight.** `gh auth status`; `gh api user`; `node -v && pnpm -v`; check the
remote. Stop only if `gh` is unauthenticated or missing the `repo` and `workflow` scopes,
or if the remote already holds substantive content beyond a README, LICENSE or
`.gitignore`.

**Step 1 — hygiene.** Scan the full tree and the entire commit history for credentials, and
run `pnpm check:clean-room`, before the first push.

**Step 2 — push.** A clean conventional-commit history. Never force-push over existing
content. Set the repository description and topics.

**Step 3 — configure.** Enable GitHub Pages with source set to GitHub Actions. Set Actions
secrets from whichever AI keys exist in the environment. Set repository variables including
the publishing kill switch, defaulted to off. Enable Dependabot.

**Step 4 — deploy.** Trigger the deploy workflow and poll until it completes.

**Step 5 — verify against the live URL, not localhost.** 200s with expected content for the
site, `/admin`, `sitemap.xml`, `rss.xml`, `robots.txt`, `llms.txt`; a real 404 for a
missing path; every locale route including Dhivehi with correct `dir` and `lang`; all
assets resolving under the sub-path; response headers correct; zero console errors;
Lighthouse thresholds met; every internal link resolving.

**Step 6 — verify the automation end to end.** One scratch repository, a real scheduler
run, a guardrail block, the kill switch, and the connector's route diff and migration
report. Then delete the scratch repository.

**Step 7 — package.** `release/dheys-cms-v1.0.0.zip` and `.bundle`, verified by unzipping
into an empty folder and passing the full gate from scratch. Attach both to a `v1.0.0`
release.

---

## 14. THE FINAL REPORT

`release/REPORT.md`, in exactly these sections: Live URLs; Verification results (a table of
check, expected, actual, pass/fail, with raw timestamped output in an appendix); What is
built; What is not built; Untested against live services; Owner TODO; Known limitations;
How to connect a site; Cost and time. Sections 1 to 3 may contain nothing aspirational.

---

## 15. DELIVERABLES

Source, plus `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`
(MIT), `CHANGELOG.md`, `.github/` templates and workflows and Dependabot config, and
`docs/` covering installation, configuration, the site registry, connecting a site, content
authoring, admin usage, theming, the agent job contract, writing a custom provider,
automation and scheduling, guardrails, i18n and RTL, fonts and licensing, custom content
types, WordPress import and troubleshooting — including `BUILD-BRIEF.md`, `STATE.md`,
`DECISIONS.md`, `PLAN.md`, `CONNECT-PROMPT.md` and `THEME-PROVENANCE.md`. Seed demo content
in three locales for fictional sites only. Ship `.env.example`.

The finished product should feel like something a small, opinionated team ships and
maintains, not a scaffold.
