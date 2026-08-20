# Dheys CMS v1.0.0 — build report

Built to `docs/BUILD-BRIEF.md`. Every figure below was produced by running the command and
reading its output; the raw, timestamped log is in the appendix. Nothing here is an
estimate unless it says so.

---

## 1. Live URLs

**There are none.** Nothing has been deployed and no URL is serving anything.

`gh` is installed (2.97.0) but not authenticated, and `gh auth login` is a browser flow
that cannot be completed from a non-interactive session. That is the one stop the brief's
preflight permits, and it blocks ship steps 2 through 6 — push, repository description and
topics, Pages configuration, Actions secrets and variables, deploy, verification against a
live URL, and the scratch-repository automation test — plus the `v1.0.0` release.

The intended URL once the operator completes OWNER-TODO 1 is
`https://nazilafeef.github.io/dheys-cms/`. It does not resolve today, and this report does
not claim otherwise.

The repository exists only on this machine: 12 commits on `main`, nothing pushed.

---

## 2. Verification results

Every row was run on the **unpacked release archive**, not on the build tree —
`release/dheys-cms-v1.0.0.zip` unzipped into an empty directory, dependencies installed
from the lockfile, and the whole gate run there from scratch. Raw output in Appendix A.

The run below was made against commit `6340dd4`. This report is the only file added after
it, and the archive was rebuilt and re-verified with it present.

| Check                            | Expected                                        | Actual                                                            | Result |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | ------ |
| `pnpm install --frozen-lockfile` | resolves from the lockfile, no warnings          | resolved, no warnings, 10.7 s                                      | pass   |
| `pnpm typecheck`                 | 0 errors                                         | 95 files: 0 errors, 0 warnings, 0 hints                            | pass   |
| `pnpm lint`                      | no errors, no warnings                           | ESLint clean; Prettier reports all files already formatted          | pass   |
| `pnpm test`                      | all pass, none skipped                           | 655 passed, 19 files, 0 skipped, 0 todo                             | pass   |
| `pnpm check:clean-room`          | no rule-2 violation in any file or commit        | 181 files scanned, 11 commit messages, 0 violations                 | pass   |
| `pnpm build`                     | completes with no warning                        | completed; only Pagefind's informational `dv` stemming note         | pass   |
| `pnpm check:links` (sub-path)    | every internal reference resolves at `/dheys-cms` | 648 references across 36 pages resolve                             | pass   |
| `pnpm check:links` (root)        | every internal reference resolves at `/`         | 648 references across 36 pages resolve                              | pass   |
| `pnpm test:e2e`                  | all pass, no network                             | 44 passed, mocked GitHub, no outbound request                       | pass   |
| Lighthouse — Performance         | ≥ 95 on all five pages                           | 100 on all five                                                     | pass   |
| Lighthouse — Accessibility       | ≥ 95 on all five pages                           | 100 on all five                                                     | pass   |
| Lighthouse — Best Practices      | ≥ 95 on all five pages                           | 100 on all five                                                     | pass   |
| Lighthouse — SEO                 | ≥ 95                                             | 100 on the four indexable pages; **not scored on 404**, see below   | pass   |
| LCP                              | < 2.0 s                                          | 907 ms, slowest page                                                | pass   |
| CLS                              | < 0.05                                           | 0.000                                                               | pass   |
| TBT                              | < 150 ms                                         | 0 ms                                                                | pass   |
| JS on an article page            | < 30 KB                                          | 2.8 KB (en) / 3.0 KB (ar), all inline, no external script           | pass   |
| Contrast                         | ≥ 4.5:1                                          | unit-tested per token pair in both themes and both colour schemes; Lighthouse accessibility 100 | pass |

**The one exemption, stated rather than hidden.** The 404 page is excluded from the SEO
category only. That score is dominated by "page is blocked from indexing", which a 404 page
must fail — being indexable would be the bug. Its Performance, Accessibility and Best
Practices scores are enforced at the full threshold and are 100. The exemption is per-page,
declared in `scripts/lighthouse.mjs`, and prints its reason on every run.

**One honest caveat on the clean-room row.** The brief forbids creating working copies
outside `D:\2026\dheys-cms`, so the archive was unpacked to a gitignored path *inside* it.
The file scan therefore used the gate's filesystem walk over the unpacked tree — confirmed,
because `git ls-files` returns nothing there — and covered exactly the 181 files the archive
contains. The commit-history scan, however, resolved to the enclosing repository, since an
unpacked archive has no history of its own. Both were clean. The gate was changed during
this verification to say which of those two it actually did rather than claiming a history
scan unconditionally; see Known limitations.

No test was skipped, marked `.todo`, or retried. No threshold was moved.

---

## 3. What is built

A static multi-site control plane, the automation that drives it, and the adapters that
write into other people's repositories. 182 files, 12 commits, MIT.

**Content and routing.** Astro 5 in static mode with the content layer. `[...locale]` rest
routes give home, article, standalone page, archive, category, author, search and 404 in
three locales (en, dv, ar) from one route file each; the default locale sits at the root and
the others are prefixed. 35 pages build. Base-path handling is shared between
`astro.config.ts` and the runtime through one module, so the build and the rendered markup
cannot disagree, and both hosting shapes — `/dheys-cms/` and `/` — are built and link-checked.

**Internationalisation.** Per-locale direction, script and measure; Thaana and Arabic
transliteration for slugs; Thaana punctuation enforced over Latin lookalikes; `hreflang` and
a language switcher that resolve each translation's own slug rather than assuming a shared
one; combining marks handled correctly in heading anchors and word counts, which is where
two real bugs were found.

**SEO and syndication.** Canonical URLs, `NewsArticle` JSON-LD that credits no `Person` to
AI-authored work, RSS, Atom, JSON Feed, a news sitemap, `robots.txt` and `llms.txt`.

**Editorial pipeline.** A state machine with actor-and-timestamp transitions, where approval
by an `agent` or `system` actor is not human approval and cannot be made to count as it. Git
history is the audit trail.

**Admin.** One Preact island on an otherwise static page: sign-in, site switching, a content
browser, a Markdown editor with live validation, slug-clash detection and
Latin-punctuation-in-Thaana warnings, and a review queue showing per-rule guardrail results.
The GitHub token lives in `sessionStorage` and nowhere else; the reasoning and its honest
cost are written out in `docs/SECURITY.md`.

**Agents.** Four providers — Anthropic, two OpenAI-shaped HTTP providers, and a webhook for
bring-your-own — behind one interface with an injected transport. A job contract whose
provenance is built from the dispatch record rather than from anything the model claims.
Guardrails covering word count, required fields, locale completeness, disclosure and human
review. Per-job and per-site cost ceilings, with unpriced models costed at the job ceiling
rather than guessed.

**Scheduling.** A pure, seeded-deterministic tick: same input, same plan, so a re-run cannot
double-publish. Missed windows are caught up rather than dropped. Timezone conversion is
IANA-based.

**Automation.** Five workflows — CI on Node 20 and 22 with a separate root-hosting build, a
nightly Windows/macOS matrix, Pages deploy that reads its base path rather than hard-coding
it, the scheduler tick, and agent dispatch. The AI keys exist only inside Actions; nothing in
the browser can reach one.

**Connector.** `pnpm connect-site` analyses an existing site, diffs its routes, refuses the
migration if any live URL would be lost, and writes a migration report into the target repo.
Verified end to end against two fictional local targets: one clean migration and one that
dropped a URL and was correctly refused with a non-zero exit.

**Tests.** 655 unit tests across 19 files and 44 Playwright tests against a real build with a
mocked GitHub. No test can reach a real AI provider or the real GitHub API — every transport
is injected, so that is a property of the wiring rather than a rule tests are trusted to
follow.

**Gates.** Clean-room, link, and Lighthouse checkers, all runnable locally and all wired into
CI.

**Documentation.** 23 documents covering installation, configuration, the site registry,
connecting a site, content authoring, admin usage, theming, the agent job contract, writing a
provider, automation, guardrails, i18n and RTL, fonts, custom content types, WordPress import
and troubleshooting, plus the brief, state, decisions, plan, connect prompt and theme
provenance. `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`,
`CHANGELOG.md`, issue and PR templates, Dependabot config, and `.env.example`.

**Demo content.** Three locales, invented sites only. No real site, client or company appears
anywhere, and a gate enforces that across every file and every commit message.

---

## 4. What is not built

- **Anything requiring a GitHub account.** No push, no repository settings, no Pages
  configuration, no Actions secrets, no deploy, no release. Blocked on OWNER-TODO 1.
- **Media library.** The admin's media view is a stub that says so. Images are referenced by
  path and committed to the site repository directly.
- **A Thaana font binary.** None ships, deliberately. `themes/dheys/fonts.css` provides a
  documented slot with the metric contract Thaana needs; `docs/FONTS.md` states the unresolved
  licensing position in full. See OWNER-TODO 4.
- **Model rates for non-Anthropic providers.** Deliberately absent rather than guessed. An
  unpriced model is costed at the job's own ceiling, so it is conservative and visible.
- **Analytics, telemetry, or any callback home.** Not built, and not going to be.
- **A hosted or paid path of any kind.** The default path is GitHub Pages and GitHub Actions.

---

## 5. Untested against live services

Stated plainly, because these are the claims this build cannot make.

- **No AI provider has been called.** No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or
  `OPENAI_API_KEY` was present in the build environment. All four providers are built,
  typechecked and unit-tested against scripted mock transports — request shape, error paths,
  token accounting, fence-stripping, and the rule that a model claiming human authorship is
  overridden. None has exchanged a byte with a real endpoint. Per the brief's decision table
  this is the expected outcome without keys, and it is recorded here rather than glossed.
- **No call to the real GitHub API.** The admin, the connector and the workflows are exercised
  against a mocked API. Rate limits, pagination at scale, and permission errors from a real
  fine-grained token are untested.
- **No deployed page has been loaded.** Every Lighthouse figure, link check and end-to-end
  test ran against a local static server serving the real build output. Behaviour that depends
  on GitHub Pages itself — response headers, redirect handling, `.xml` content types, CDN
  caching — is inferred from how Pages is documented to behave, not observed.
- **The scheduler has never run on a real cron.** Its logic is pure and tested exhaustively
  with injected clocks; the Actions cron trigger has not fired.
- **The kill switch and a real guardrail block have not been exercised end to end** against a
  live repository. Both are unit-tested and both appear in the e2e suite against a mock.

---

## 6. Owner TODO

Full detail, with time estimates, in `release/OWNER-TODO.md`. In short:

1. **Authenticate the GitHub CLI** — 2 minutes, and it unblocks the entire ship sequence.
   `gh auth login -h github.com -s repo,workflow,admin:repo_hook -w`
2. **Confirm the Dheys logo is the intended artwork** — 1 minute, cosmetic.
3. **Have the Dhivehi and Arabic UI strings reviewed by a native speaker** — about an hour.
   They are complete and structurally correct; the wording needs a pass.
4. **Decide the Thaana font question** — depends on the licence holder.
5. **Set the AI provider keys you intend to use** — 5 minutes each, and none is required.
6. **Choose where the site registry lives** — 10 minutes; gist, companion repo, or secret.

---

## 7. Known limitations

- **The clean-room gate does not read bare hostnames inside source files.** A hostname with
  no scheme and no `www.` inside a `.ts` string literal would not be caught. Every other form
  is, and all site configuration lives in YAML, JSON or Markdown, which are scanned in full.
  If configuration ever moves into a `.ts` file, that file must join the prose set.
  (DECISIONS #5.)
- **Pagefind has no Dhivehi stemmer.** Search works and matches exact words; it will not match
  across root forms in `dv`. The build says so, and so does `docs/troubleshooting.md`.
- **The admin token is readable by any script on the origin.** No server means no `httpOnly`
  cookie. The mitigations — operator-chosen repository scope, session lifetime, no
  `localStorage`, no `unsafe-eval`, no runtime schema compiler — are real but they are
  mitigations. `docs/SECURITY.md` documents a GitHub App path for operators who need the
  credential out of the browser.
- **The Anthropic JSON Schema is maintained by hand beside the Zod schema**, because Astro's
  content layer pins Zod 3 and the SDK's Zod helper targets Zod 4. A test asserts the two
  agree on the required-field set, so they cannot drift silently — but a new field must be
  added in both places.
- **Two locales are unreviewed.** See OWNER-TODO 3.
- **The archive's clean-room verification read the enclosing repository's commit history,**
  not one of its own, because the brief requires the unpacked copy to stay inside the working
  directory. The file scan did cover the archive's own 181 files. The gate now distinguishes
  the two cases in its output instead of claiming a history scan unconditionally; before that
  fix it would have reported "plus commit history" while reading none, which is the kind of
  false green this report exists to avoid.

---

## 8. How to connect a site

Full walkthrough in `docs/connecting-a-site.md`; the one-prompt version is
`docs/CONNECT-PROMPT.md`. The short form:

1. **Choose where the registry lives** — a private gist, a private companion repository, or a
   repository secret. It never lives in this repository. `docs/site-registry.md` compares the
   three.
2. **Describe the site** — repository, content path, locales, content type, theme, guardrails,
   and which deploy adapter it uses. One entry per site; the schema is validated on load and
   tells you what is missing.
3. **Point the CMS at the registry** — one repository variable for the location, one secret if
   the source is private.
4. **Run `pnpm connect-site`** against an existing site to migrate it. It reads the current
   routes, diffs them against what Dheys would produce, and **refuses the migration if any
   live URL would be lost** rather than redirecting and hoping. On success it writes
   `MIGRATION-REPORT.md` into the target repository so there is a record of what moved.
5. **Sign in at `/admin`** with a fine-grained PAT scoped to the repositories in the registry,
   and the site appears.

A site does not need to be an Astro site. Four content adapters cover the common shapes, and
`docs/custom-content-types.md` covers writing another.

---

## 9. Cost and time

**Cost to run the product: nothing, on the default path.** GitHub Pages hosts the control
plane, GitHub Actions runs the automation, and both are free for a public repository. There
is no database, no backend, no paid service anywhere in the default path, and no telemetry.

The only variable cost is AI generation, and only when an agent is actually commissioned —
every provider is opt-in and the CMS runs with none configured. Spend is bounded rather than
observed: each job carries a `maxCostUsd` ceiling checked *before* dispatch, each site carries
a period cap, and a model with no published rate is costed at the job ceiling rather than
guessed cheap. `docs/automation.md` covers the accounting.

**Cost of this build: not measurable from inside it.** No token or billing figure is available
to the process that produced this, and inventing one would be worse than the gap.

**Time.** The build ran across several sessions ending 2026-08-21. Measured gate timings, from
the appendix log:

| Stage                              | Time    |
| ---------------------------------- | ------- |
| `pnpm install --frozen-lockfile`   | 10.7 s  |
| `pnpm typecheck`                   | 15 s    |
| `pnpm lint`                        | 8 s     |
| `pnpm test` (655)                  | 4 s     |
| `pnpm check:clean-room`            | 1 s     |
| `pnpm build` (35 pages)            | 6 s     |
| `pnpm check:links`                 | < 1 s   |
| `pnpm test:e2e` (44)               | 22 s    |
| `pnpm lighthouse` (5 pages)        | 44 s    |
| **Full gate, cold, from an archive** | **1 m 51 s** |

A contributor's inner loop is the first five rows — about 40 seconds.

---

## Appendix A — raw gate output

Verbatim, from unzipping `release/dheys-cms-v1.0.0.zip` into an empty directory and running
every gate there. Timestamps are UTC.

```text
==================================================================
host      : MINGW64_NT-10.0-26200 3.6.9-b4195d69.x86_64
node      : v22.23.2
pnpm      : 10.34.5
commit    : 6340dd4
directory : dheys-cms-v1.0.0/  (the unpacked archive, in an empty directory)
started   : 2026-08-20T23:23:21Z
==================================================================

$ pnpm install --frozen-lockfile
  [started 2026-08-20T23:23:21Z]
+ typescript-eslint 8.67.0
+ vitest 3.2.7

Done in 10.7s using pnpm v10.34.5
  [finished 2026-08-20T23:23:32Z] exit=0

$ pnpm typecheck
  [started 2026-08-20T23:23:32Z]
Result (95 files):
- 0 errors
- 0 warnings
- 0 hints

  [finished 2026-08-20T23:23:47Z] exit=0

$ pnpm lint
  [started 2026-08-20T23:23:47Z]

Checking formatting...
All matched files use Prettier code style!
  [finished 2026-08-20T23:23:55Z] exit=0

$ pnpm test
  [started 2026-08-20T23:23:55Z]
   ✓ clean-room gate — what the summary claims > reports the number of commit messages it actually read  792ms
   ✓ clean-room gate — what the summary claims > does not claim to have read a history when there is none  631ms

 Test Files  19 passed (19)
      Tests  655 passed (655)
   Start at  04:23:56
   Duration  2.83s (transform 3.60s, setup 0ms, collect 10.75s, tests 2.46s, environment 7ms, prepare 9.26s)

  [finished 2026-08-20T23:23:59Z] exit=0

$ pnpm check:clean-room
  [started 2026-08-20T23:23:59Z]
> node scripts/check-clean-room.mjs

clean-room: OK -- 181 file(s) scanned plus 11 commit message(s), no violations.
  [finished 2026-08-20T23:24:00Z] exit=0

$ pnpm build
  [started 2026-08-20T23:24:00Z]
Note: Pagefind doesn't support stemming for the language dv.
Search will still work, but will not match across root words.

Finished in 0.087 seconds
  [finished 2026-08-20T23:24:06Z] exit=0

$ pnpm check:links
  [started 2026-08-20T23:24:06Z]
> node scripts/check-links.mjs

check:links: OK — 648 internal reference(s) across 36 page(s) resolve, base "/dheys-cms". 54 external target(s) left unrequested.
  [finished 2026-08-20T23:24:06Z] exit=0

$ pnpm test:e2e
  [started 2026-08-20T23:24:06Z]
  ok 40 [chromium] › tests\e2e\public-site.spec.ts:289:3 › SEO head › hreflang points at each translation’s own slug (754ms)
  ok 44 [chromium] › tests\e2e\public-site.spec.ts:321:3 › language switching › offers the article in its other languages, at their own slugs (976ms)

  44 passed (14.2s)
  [finished 2026-08-20T23:24:28Z] exit=0

$ pnpm lighthouse
  [started 2026-08-20T23:24:28Z]

404 — http://127.0.0.1:4325/dheys-cms/404
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  n/a  SEO                63  (a 404 must be noindex, which is precisely what the SEO category penalises)
  ok   Agentic Browsing   100
  ok   LCP                907ms
  ok   CLS                0.000
  ok   TBT                0ms

lighthouse: OK — 5 page(s), all categories >= 95, all metrics inside budget.
  [finished 2026-08-20T23:25:12Z] exit=0

finished  : 2026-08-20T23:25:12Z
```

## Appendix B — root-hosting link check

The sub-path run is in Appendix A. Root hosting is a first-class mode and is checked
separately, from PowerShell: Git Bash rewrites a lone `/` argument into a Windows path, so
the same command run there checks a nonsense base and passes without meaning anything.

```text
  [started 2026-08-20T23:25:37Z]
Finished in 0.028 seconds
check:links: OK -- 648 internal reference(s) across 36 page(s) resolve, base "/". 54 external target(s) left unrequested.
  [finished 2026-08-20T23:25:43Z] exit=0
```
