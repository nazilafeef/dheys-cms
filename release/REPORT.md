# Dheys CMS v1.0.0 — build report

Built to `docs/BUILD-BRIEF.md`, with three amendments from the operator: this repository
never holds a secret, the release archive is verified by cloning the bundle, and ship step 6
runs without any AI provider. Every figure below was produced by running the command and
reading its output; the raw logs are in the appendices. Nothing here is an estimate unless
it says so.

---

## 1. Live URLs

**There are none.** Nothing is deployed and no URL is serving anything.

`https://nazilafeef.github.io/dheys-cms/` returns **404**, checked directly. The repository
`nazilafeef/dheys-cms` does exist and is public — it was created 2026-08-20T11:03:42Z — but
it is empty: zero branches, zero bytes, no description, no topics, and Pages disabled.
Nothing has ever been pushed to it.

The reason is a missing credential, and it is not recoverable from here:

| Credential                | State                                                 |
| ------------------------- | ------------------------------------------------------ |
| `gh` CLI                  | installed (2.97.0), **not authenticated**              |
| `GH_TOKEN` / `GITHUB_TOKEN` | not set                                              |
| `gh` config directory     | does not exist                                         |
| `git push`                | `fatal: could not read Username for 'https://github.com'` |

`gh auth login` is a browser flow that needs the operator's hands. That is the one stop the
brief's preflight permits, and it blocks **ship steps 2, 3, 4, 5 and 7** entirely: push,
repository description and topics, Pages configuration, repository variables, Dependabot,
deploy, live-URL verification, and the `v1.0.0` release.

**Step 5 could therefore not be run.** Every check it specifies — 200s for the site, `/admin`,
`sitemap.xml`, `rss.xml`, `robots.txt`, `llms.txt`; a real 404 for a missing path; every
locale route with correct `dir` and `lang`; assets resolving under the sub-path; response
headers; zero console errors; Lighthouse thresholds; every internal link — is verified
against a local server serving the real build output, and none of it against the live URL.
The distinction is preserved in section 2 rather than blurred.

The one thing that did not need a credential is **step 6**, and it was run in full: see
section 2 and Appendix B.

The repository exists only on this machine: 19 commits on `main`, remote configured, nothing
pushed.

---

## 2. Verification results

Two suites, both run in full. Raw output in Appendix A and Appendix B.

### 2a. The product, verified from the release artefact

`pnpm verify:release` builds the zip and bundle from HEAD, **clones the bundle** into an
empty directory — a genuine standalone repository, with its own history — and runs the whole
gate there. Nothing below was measured against the build tree.

| Check                            | Expected                                          | Actual                                                    | Result |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------- | ------ |
| clone has its own `.git`          | git stops at the clone boundary                   | toplevel resolves to the clone                             | pass   |
| clean-room in the clone           | no rule-2 violation in any file or commit         | 185 files, 18 commit messages, 0 violations                | pass   |
| **history is the clone's own**    | reported count equals the bundle's                | 18 == 18                                                   | pass   |
| **history is not this repo's**    | a marker commit moves only the clone              | 19 == 19, and != 18                                        | pass   |
| clone restored after the probe    | ships exactly as verified                         | 18 == 18                                                   | pass   |
| zip vs bundle                     | identical file lists                              | 185 files, no difference                                   | pass   |
| zip excludes build output         | no `node_modules/`, `dist/`, `.git/`              | 0 found                                                    | pass   |
| `pnpm install --frozen-lockfile`  | resolves from the lockfile, no warnings           | resolved, 11.6 s                                           | pass   |
| `pnpm typecheck`                  | 0 errors                                          | 95 files: 0 errors, 0 warnings, 0 hints                    | pass   |
| `pnpm lint`                       | no errors, no warnings                            | ESLint clean; Prettier reports all files formatted          | pass   |
| `pnpm test`                       | all pass, none skipped                            | 658 passed, 20 files, 0 skipped, 0 todo                    | pass   |
| `pnpm build`                      | completes with no warning                         | completed; only Pagefind's informational `dv` note          | pass   |
| `pnpm check:links` (sub-path)     | every internal reference resolves at `/dheys-cms` | 648 references across 36 pages resolve                     | pass   |
| `pnpm check:links` (root)         | every internal reference resolves at `/`          | 648 references across 36 pages resolve                     | pass   |
| `pnpm test:e2e`                   | all pass, no network                              | 44 passed, mocked GitHub, no outbound request              | pass   |
| Lighthouse — Performance          | ≥ 95 on all five pages                            | 100 on all five                                            | pass   |
| Lighthouse — Accessibility        | ≥ 95 on all five pages                            | 100 on all five                                            | pass   |
| Lighthouse — Best Practices       | ≥ 95 on all five pages                            | 100 on all five                                            | pass   |
| Lighthouse — SEO                  | ≥ 95                                              | 100 on the four indexable pages; **not scored on 404**      | pass   |
| LCP                               | < 2.0 s                                           | 907 ms, slowest page                                       | pass   |
| CLS                               | < 0.05                                            | 0.000                                                      | pass   |
| TBT                               | < 150 ms                                          | 0 ms                                                       | pass   |
| JS on an article page             | < 30 KB                                           | 2.8 KB (en) / 3.0 KB (ar), all inline, no external script  | pass   |
| Contrast                          | ≥ 4.5:1                                           | unit-tested per token pair, both themes, both schemes       | pass   |

**Every one of those ran against a local server**, not the live URL. See section 1.

**The one exemption, stated rather than hidden.** The 404 page is excluded from the SEO
category only. That score is dominated by "page is blocked from indexing", which a 404 must
fail — being indexable would be the bug. Its other three categories are enforced at the full
threshold and are 100. The exemption is per-page and prints its reason on every run.

### 2b. Ship step 6 — the automation, end to end, with no AI provider

`pnpm verify:automation`. A local stand-in for the scratch repository: an HTTP server
implementing the GitHub endpoints the scheduler uses, backed by a real git repository on
disk. The runners are not stubbed — they resolve their API root from `GITHUB_API_URL`, which
every Actions runner sets and which GitHub Enterprise Server requires anyone to honour, so
this exercises the production code path over real HTTP.

| Check                        | Expected                                       | Actual                                     | Result |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------- | ------ |
| kill switch on               | scheduler stops, explains, commits nothing     | exit 0, reason printed, 0 commits            | pass   |
| kill switch is read first    | nothing else happens before it                 | registry never read                          | pass   |
| a real run, switch off       | scheduler completes                            | exit 0                                       | pass   |
| ordering                     | kill switch, then registry, then content       | as specified                                 | pass   |
| the publishable item         | due + human-approved + guardrails clear → publishes | `content/posts/en/due-and-clean.md` committed | pass |
| **guardrail block — words**  | a 3-word article does not publish              | held back                                    | pass   |
| **guardrail block — review** | agent-only approval is not human approval      | held back                                    | pass   |
| the run explains itself      | says what it held and why                      | reported                                     | pass   |
| idempotency                  | a second tick publishes nothing again          | 0 further commits                            | pass   |
| connector — clean migration  | exits 0, diffs routes, writes the report       | `MIGRATION-REPORT.md` written                | pass   |
| connector — report content   | carries route verification and open items      | both sections present                        | pass   |
| **connector — refusal**      | a migration losing a live URL is refused       | **exit 1**, nothing pushed                   | pass   |
| no provider key anywhere     | all three cleared in every child environment   | cleared                                      | pass   |
| no provider traffic          | every request is a GitHub API path             | 15 requests, 7 distinct, all `/repos/…`      | pass   |

The refusal case is a Decap site whose build renders one page from `admin/config.yml`.
Removing Decap removes that page, so `/about` stops being served and the connector refuses.
That is not a contrived failure — it is the ordinary way a real migration quietly breaks a
site.

**What step 6 does not prove**, because a stand-in cannot: GitHub's own behaviour — rate
limits, pagination at scale, permission errors from a real fine-grained token, and the exact
error bodies it returns. Those need the real API and the scratch repository the brief asks
for, which needs the credential in section 1.

No test was skipped, marked `.todo`, or retried. No threshold was moved.

---

## 3. What is built

A static multi-site control plane, the automation that drives it, and the adapters that write
into other people's repositories. 185 files, 19 commits, MIT.

**Content and routing.** Astro 5 in static mode with the content layer. `[...locale]` rest
routes give home, article, standalone page, archive, category, author, search and 404 in three
locales (en, dv, ar) from one route file each; the default locale sits at the root and the
others are prefixed. 35 pages build. Base-path handling is shared between `astro.config.ts`
and the runtime through one module, so the build and the rendered markup cannot disagree, and
both hosting shapes — `/dheys-cms/` and `/` — are built and link-checked.

**Internationalisation.** Per-locale direction, script and measure; Thaana and Arabic
transliteration for slugs; Thaana punctuation enforced over Latin lookalikes; `hreflang` and a
language switcher that resolve each translation's own slug rather than assuming a shared one;
combining marks handled correctly in heading anchors and word counts, which is where two real
bugs were found.

**SEO and syndication.** Canonical URLs, `NewsArticle` JSON-LD that credits no `Person` to
AI-authored work, RSS, Atom, JSON Feed, a news sitemap, `robots.txt` and `llms.txt`.

**Editorial pipeline.** A state machine with actor-and-timestamp transitions, where approval by
an `agent` or `system` actor is not human approval and cannot be made to count as it — proven
end to end in section 2b, not merely unit-tested. Git history is the audit trail.

**Admin.** One Preact island on an otherwise static page: sign-in, site switching, a content
browser, a Markdown editor with live validation, slug-clash detection and
Latin-punctuation-in-Thaana warnings, and a review queue showing per-rule guardrail results.
The GitHub token lives in `sessionStorage` and nowhere else; the reasoning and its honest cost
are written out in `docs/SECURITY.md`.

**Agents.** Four providers — Anthropic, two OpenAI-shaped HTTP providers, and a webhook for
bring-your-own — behind one interface with an injected transport. A job contract whose
provenance is built from the dispatch record rather than from anything the model claims.
Guardrails covering word count, required fields, locale completeness, disclosure and human
review. Per-job and per-site cost ceilings, with unpriced models costed at the job ceiling.

**Scheduling.** A pure, seeded-deterministic tick: same input, same plan, so a re-run cannot
double-publish — verified as a real second tick in section 2b. Missed windows are caught up
rather than dropped. Timezone conversion is IANA-based.

**Automation.** Five workflows — CI on Node 20 and 22 with a separate root-hosting build, a
nightly Windows/macOS matrix, Pages deploy that reads its base path rather than hard-coding it,
the scheduler tick, and agent dispatch. Runners resolve their API root from `GITHUB_API_URL`,
so GitHub Enterprise Server works. The AI keys exist only inside Actions on a private instance;
nothing in a browser can reach one.

**Connector.** `pnpm connect-site` analyses an existing site, diffs its routes, refuses the
migration if any live URL would be lost, and writes a migration report into the target repo.

**Release verification.** `pnpm verify:release` proves the artefacts rather than the tree they
came from, including a positive proof that the clean-room gate reads the shipped history and
not this repository's.

**Tests.** 658 unit tests across 20 files and 44 Playwright tests against a real build with a
mocked GitHub. No test can reach a real AI provider or the real GitHub API — every transport is
injected, so that is a property of the wiring rather than a rule tests are trusted to follow.

**Documentation.** 23 documents, plus `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md`, `LICENSE`, `CHANGELOG.md`, issue and PR templates, Dependabot config, and
`.env.example`. README and `docs/installation.md` both explain the public/private split.

**Demo content.** Three locales, invented sites only. No real site, client or company appears
anywhere, and a gate enforces that across every file and every commit message.

---

## 4. What is not built

- **Anything requiring a GitHub credential.** No push, no repository settings, no Pages
  configuration, no repository variables, no Dependabot enablement, no deploy, no release.
  Blocked on OWNER-TODO 1.
- **Actions secrets — deliberately, and permanently.** Not an unfinished step. This repository
  is the published product and its secret store stays empty; keys live in the operator's
  private instance. See OWNER-TODO 7 and DECISIONS 49.
- **Media library.** The admin's media view is a stub that says so. Images are referenced by
  path and committed to the site repository directly.
- **A Thaana font binary.** None ships, deliberately. `themes/dheys/fonts.css` provides a
  documented slot with the metric contract Thaana needs; `docs/FONTS.md` states the unresolved
  licensing position in full. See OWNER-TODO 4.
- **Model rates for non-Anthropic providers.** Absent rather than guessed. An unpriced model is
  costed at the job's own ceiling, so it is conservative and visible.
- **Analytics, telemetry, or any callback home.** Not built, and not going to be.
- **A hosted or paid path of any kind.** The default path is GitHub Pages and GitHub Actions.

---

## 5. Untested against live services

**No AI provider has ever been called. Not once, at any point in this build.**

No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` was present in the environment,
and per the operator's amendment none was read, requested, or written anywhere. All four
providers are built, typechecked and unit-tested against scripted mock transports — request
shape, error paths, token accounting, fence-stripping, and the rule that a model claiming human
authorship is overridden. None has exchanged a byte with a real endpoint, and nothing in this
repository is configured to let it.

**Live-provider verification happens in the private instance, not here.** That is the design,
not a gap in it: this repository is the published product and holds no keys, so it is the wrong
place to exercise a provider from. An operator who wants that assurance sets their keys on
their own instance and commissions one job. `docs/installation.md` and OWNER-TODO 5 say so.

The rest of what has not touched a live service:

- **No call to the real GitHub API.** The admin, the connector, the scheduler and the workflows
  are exercised against mocks and against the local stand-in described in section 2b. Rate
  limits, pagination at scale, and permission errors from a real fine-grained token are
  untested.
- **No deployed page has been loaded.** Every Lighthouse figure, link check and end-to-end test
  ran against a local static server serving the real build output. Behaviour that depends on
  GitHub Pages itself — response headers, redirect handling, `.xml` content types, CDN caching
  — is inferred from how Pages is documented to behave, not observed. Step 5 has not run.
- **The scheduler has never run on a real cron.** Its logic is pure and exhaustively tested with
  injected clocks, and a real tick has now been run end to end against the stand-in, but the
  Actions cron trigger has not fired.
- **The kill switch and guardrail blocks have now been exercised end to end** — against the
  stand-in, not against a live repository.

---

## 6. Owner TODO

Full detail, with time estimates, in `release/OWNER-TODO.md`. In short:

1. **Authenticate the GitHub CLI** — 2 minutes, and it unblocks the entire ship sequence.
   `gh auth login -h github.com -s repo,workflow,admin:repo_hook -w`
2. **Confirm the Dheys logo is the intended artwork** — 1 minute, cosmetic.
3. **Have the Dhivehi and Arabic UI strings reviewed by a native speaker** — about an hour.
4. **Decide the Thaana font question** — depends on the licence holder.
5. **Set the AI provider keys you intend to use — on your private instance, not here** — 5
   minutes each, and none is required.
6. **Choose where the site registry lives** — 10 minutes; private gist, private companion repo,
   or a secret.
7. **Nothing is missing from this repository's secret store** — no action. Recorded so an empty
   secrets page reads as a decision rather than an oversight.

---

## 7. Known limitations

- **The clean-room gate does not read bare hostnames inside source files.** A hostname with no
  scheme and no `www.` inside a `.ts` string literal would not be caught. Every other form is,
  and all site configuration lives in YAML, JSON or Markdown, which are scanned in full.
  (DECISIONS #5.)
- **Pagefind has no Dhivehi stemmer.** Search works and matches exact words; it will not match
  across root forms in `dv`. The build says so, and so does `docs/troubleshooting.md`.
- **The admin token is readable by any script on the origin.** No server means no `httpOnly`
  cookie. The mitigations — operator-chosen repository scope, session lifetime, no
  `localStorage`, no `unsafe-eval`, no runtime schema compiler — are real, but they are
  mitigations. `docs/SECURITY.md` documents a GitHub App path for operators who need the
  credential out of the browser.
- **The Anthropic JSON Schema is maintained by hand beside the Zod schema**, because Astro's
  content layer pins Zod 3 and the SDK's Zod helper targets Zod 4. A test asserts the two agree
  on the required-field set, so they cannot drift silently — but a new field must be added in
  both places.
- **Two locales are unreviewed.** See OWNER-TODO 3.
- **Step 6 ran against a stand-in, not a scratch repository.** What that does and does not prove
  is set out in section 2b rather than left implicit.
- **Four empty directories under `.tmp/` will not delete on this machine.** Windows holds
  handles on trees that were just built and served. They are gitignored, skipped by every gate,
  and excluded from the archive; each verification run uses its own directory so a lock never
  blocks the next run.

**Resolved since the last report.** The archive used to be verified by unzipping it inside this
repository, where a zip's lack of a `.git` meant every git-aware check resolved upward and the
clean-room gate read *this* history while reporting on the archive. It now clones the bundle,
which is a real repository, and proves it by marker commit. DECISIONS #46.

---

## 8. How to connect a site

Full walkthrough in `docs/connecting-a-site.md`; the one-prompt version is
`docs/CONNECT-PROMPT.md`. The short form:

1. **Run your own private instance.** Fork this repository, keep the fork private, and put your
   keys and registry there. Never in a public copy. See
   `docs/installation.md#run-your-own-private-instance`.
2. **Choose where the registry lives** — a private gist, a private companion repository, or a
   repository secret. `docs/site-registry.md` compares the three.
3. **Describe the site** — repository, content path, locales, content type, theme, guardrails,
   and which deploy adapter it uses. The schema is validated on load and tells you exactly what
   is missing, field by field.
4. **Point the CMS at the registry** — one repository variable for the location, one secret if
   the source is private.
5. **Run `pnpm connect-site`** against an existing site to migrate it. It reads the current
   routes, diffs them against what Dheys would produce, and **refuses the migration if any live
   URL would be lost** rather than redirecting and hoping — verified in section 2b. On success
   it writes `MIGRATION-REPORT.md` into the target repository.
6. **Sign in at `/admin`** with a fine-grained PAT scoped to the repositories in the registry.

A site does not need to be an Astro site. Four content adapters cover the common shapes, and
`docs/custom-content-types.md` covers writing another.

---

## 9. Cost and time

**Cost to run the product: nothing, on the default path.** GitHub Pages hosts the control
plane, GitHub Actions runs the automation, and both are free for a public repository. There is
no database, no backend, no paid service anywhere in the default path, and no telemetry.
Deploying needs no secret at all — the workflow uses the built-in `GITHUB_TOKEN`.

The only variable cost is AI generation, and only when an agent is actually commissioned on a
private instance — every provider is opt-in and the CMS runs with none configured. Spend is
bounded rather than observed: each job carries a `maxCostUsd` ceiling checked *before* dispatch,
each site carries a period cap, and a model with no published rate is costed at the job ceiling
rather than guessed cheap.

**Cost of this build: not measurable from inside it, and zero in provider spend.** No token or
billing figure is available to the process that produced this, and inventing one would be worse
than the gap. What is certain is that no AI provider was called, so provider spend for this
build is nothing.

**Time.** Measured, from the appendix logs:

| Stage                                            | Time         |
| ------------------------------------------------ | ------------ |
| `pnpm install --frozen-lockfile` (warm store)     | 11.6 s       |
| `pnpm typecheck`                                  | 17 s         |
| `pnpm lint`                                       | 8 s          |
| `pnpm test` (658)                                 | 4 s          |
| `pnpm build` (35 pages)                           | 7 s          |
| `pnpm check:links`                                | < 1 s        |
| `pnpm test:e2e` (44)                              | 23 s         |
| `pnpm lighthouse` (5 pages)                       | 45 s         |
| **`pnpm verify:release`, whole thing**            | **1 m 59 s** |
| **`pnpm verify:automation`, whole thing**         | **59 s**     |

A genuinely cold install, fetching every package, took 5 m 50 s on an earlier run and dominates
everything else. A contributor's inner loop is the first five rows — about 40 seconds.

---

## Appendix A — release verification, raw output

`pnpm verify:release`, verbatim. Timestamps are UTC.

```text
started 2026-08-21T04:47:19Z

> dheys-cms@1.0.0 verify:release D:\2026\dheys-cms
> node scripts/verify-release.mjs

verify-release: HEAD 8e17d64
  ok   working tree is clean

== building artefacts from HEAD
  ok   zip written -- release\dheys-cms-v1.0.0.zip
  ok   bundle written -- release\dheys-cms-v1.0.0.bundle

== cloning the bundle into a standalone repository
  ok   the clone has its own .git
  ok   git inside the clone resolves to the clone, not the outer repository -- ./.tmp/release-verify/clone-20260821044720

== proving the clean-room gate reads the clone history, not this one
  bundle/clone commits : 18
  this repository      : 18
  gate says            : clean-room: OK -- 185 file(s) scanned plus 18 commit message(s), no violations.
  ok   clean-room passes in the clone -- exit=0
  ok   the gate reports a commit count at all -- clean-room: OK -- 185 file(s) scanned plus 18 commit message(s), no violations.
  ok   reported count equals the bundle own history -- 18 == 18
  with a marker commit : clean-room: OK -- 185 file(s) scanned plus 19 commit message(s), no violations.
  ok   the marker moved the clone history by one -- 19
  ok   the gate followed the clone, not this repository -- 19 == 19, and != 18
  ok   the clone is left exactly as it will ship -- 18 == 18

== checking the zip and the bundle ship the same files
  ok   zip file list matches the clone tracked files -- 185 files
  ok   zip excludes node_modules, dist and .git -- 0 found

== running the full gate in the clone
  ok   pnpm install -- exit=0, 11.3s
  ok   pnpm typecheck -- exit=0, 17.3s
  ok   pnpm lint -- exit=0, 8.0s
  ok   pnpm test -- exit=0, 4.4s
  ok   pnpm build -- exit=0, 7.1s
  ok   pnpm check:links -- exit=0, 0.4s
  ok   pnpm test:e2e -- exit=0, 22.7s
  ok   pnpm lighthouse -- exit=0, 44.9s

== OK
  185 files, 18 commits, verified from the bundle.
finished 2026-08-21T04:49:18Z
```

## Appendix B — ship step 6, raw output

`pnpm verify:automation`, verbatim. Timestamps are UTC.

```text
started 2026-08-21T04:49:28Z
verify-automation: ship step 6, without any AI provider


== building the scratch site repository
  ok   scratch repository created -- .tmp\automation-verify\run-20260821044928\scratch-site
  ok   three items seeded: one publishable, one too short, one agent-approved

== the kill switch halts everything
  ok   scheduler exits cleanly with the switch on -- exit=0
  ok   it says why it stopped
  ok   it committed nothing -- 0 commits
  ok   it did not even read the registry

== a real scheduler run, switch off
  ok   scheduler exits cleanly -- exit=0
  ok   it read the kill switch first
  ok   it read the site content
  ok   the due, human-approved, guardrail-passing item published -- content/posts/en/due-and-clean.md

== guardrails hold back what should not publish
  ok   the too-short item did NOT publish
  ok   the agent-approved item did NOT publish
  ok   the run reports what it held back and why

== a second tick is a no-op
  ok   second run exits cleanly -- exit=0
  ok   it published nothing a second time -- 0 commits

== the connector diffs routes and writes a migration report
  ok   connector exits cleanly on a site whose routes all survive -- exit=0
  ok   it reports a route diff
  ok   it wrote MIGRATION-REPORT.md into the target
  ok   the report carries the route verification -- 1133 bytes
  ok   the report records what still needs a person

== the connector refuses a migration that would lose a live URL
  ok   a lost URL is refused rather than redirected away -- exit=1

== no AI provider was involved
  ok   every provider key was cleared in the child environment -- all three set empty
  ok   every request the runner made was a GitHub API path -- 15 requests, 7 distinct

== OK
finished 2026-08-21T04:50:27Z
```

## Appendix C — the missing credential

Evidence for section 1, so the blocker is a fact rather than a claim.

```text
$ gh auth status
You are not logged into any GitHub hosts. To log in, run: gh auth login

$ GIT_TERMINAL_PROMPT=0 git -c credential.helper= push -u origin main
fatal: could not read Username for 'https://github.com': terminal prompts disabled

$ curl -o /dev/null -w '%{http_code}' https://nazilafeef.github.io/dheys-cms/
404

$ curl https://api.github.com/repos/nazilafeef/dheys-cms
  full_name: nazilafeef/dheys-cms
  description: None
  topics: []
  default_branch: main
  size: 0
  visibility: public
  has_pages: False
  created_at: 2026-08-20T11:03:42Z

$ curl https://api.github.com/repos/nazilafeef/dheys-cms/branches
  []
```
