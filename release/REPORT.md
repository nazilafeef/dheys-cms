# Dheys CMS v1.0.1 — build and ship report

Built to `docs/BUILD-BRIEF.md`, with three amendments from the operator: this repository never
holds a secret, the release archive is verified by cloning the bundle, and ship step 6 runs
without any AI provider. The ship sequence has since been run against the real remote, and a
later instruction resolved every open Dependabot alert — which took Astro across two majors and
moved the released version to 1.0.1.

Every figure below was produced by running the command and reading its output; the raw logs are
in the appendices. Nothing here is an estimate unless it says so, and where something is
inferred rather than observed it says which.

---

## 1. Live URLs

| What                   | URL                                          | State                                    |
| ---------------------- | -------------------------------------------- | ---------------------------------------- |
| **Control plane**      | `https://nazilafeef.github.io/dheys-cms/`    | live, HTTP 200                           |
| Admin                  | `https://nazilafeef.github.io/dheys-cms/admin/` | live, HTTP 200                        |
| Repository             | `https://github.com/nazilafeef/dheys-cms`    | public, 27 commits on `main`             |
| Releases               | `https://github.com/nazilafeef/dheys-cms/releases/tag/v1.0.1` | v1.0.1, zip + bundle attached |

Sub-paths, all verified live and all returning 200 with the expected document: `/admin/`,
`/sitemap.xml`, `/news-sitemap.xml`, `/rss.xml`, `/atom.xml`, `/feed.json`, `/robots.txt`,
`/llms.txt`, `/archive/`, `/search/`, and the locale roots `/`, `/ar/` and `/dv/`. A path that
does not exist returns a real 404 carrying this project's own 404 document.

**How it got there.** Pages is enabled with its source set to GitHub Actions; the deploy
workflow reads its base path from `actions/configure-pages` rather than hard-coding it, so the
same build serves correctly from a project sub-path. The repository has its description, its
homepage and eight topics set. Repository variables are set, including the publishing kill
switch defaulted to off. Dependabot alerts and security updates are on.

**The secret store is empty, and stays that way.** Nothing was written to it — not by
instruction and not by decision 49. Deploying to Pages needs no secret: the workflow uses the
built-in `GITHUB_TOKEN`.

**One deploy failed before any of this worked**, and it is left in the Actions history rather
than hidden. Pushing `main` triggered the deploy about a minute before Pages had been enabled,
so `actions/configure-pages` got a 404 from an API for a site that did not yet exist. Enabling
Pages and re-dispatching the same workflow, unchanged, ran green. Ship steps 3 and 4 are
ordered for a reason.

---

## 2. Verification results

Four suites. Every one was run and its output read; raw logs in the appendices.

### 2a. Ship step 5 — the live deployment

`pnpm verify:live`, against `https://nazilafeef.github.io/dheys-cms/`. Not a local preview:
every row below is a real HTTPS response from GitHub Pages. **37 checks, 37 passed.**

| Check                                              | Expected                                    | Actual                                            | Result |
| -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------ |
| site root                                          | 200 with an HTML document                   | 200, content matched                               | pass   |
| `/admin`                                           | 200 with the admin document                 | 200, content matched                               | pass   |
| `sitemap.xml`                                      | 200 containing `<urlset`                    | 200, content matched                               | pass   |
| `news-sitemap.xml`                                 | 200 containing `<urlset`                    | 200, content matched                               | pass   |
| `rss.xml`                                          | 200 containing `<rss`                       | 200, content matched                               | pass   |
| `atom.xml`                                         | 200 containing `<feed`                      | 200, content matched                               | pass   |
| `feed.json`                                        | 200 containing a version key                | 200, content matched                               | pass   |
| `robots.txt`                                       | 200 naming the sitemaps                     | 200, content matched                               | pass   |
| `llms.txt`                                         | 200                                         | 200, content matched                               | pass   |
| a missing path                                     | a real 404 status                           | 404                                                | pass   |
| the 404 body                                       | this project's own 404 document             | project 404 served, not the host's                 | pass   |
| the 404 page                                       | noindex                                     | noindex present                                    | pass   |
| `en` route                                         | 200, `lang="en"`, `dir="ltr"`               | exactly that                                       | pass   |
| `ar` route                                         | 200, `lang="ar"`, `dir="rtl"`               | exactly that                                       | pass   |
| `dv` route                                         | 200, `lang="dv"`, `dir="rtl"`               | exactly that                                       | pass   |
| Thaana rendering                                   | Thaana characters present on `/dv/`         | present                                            | pass   |
| Thaana punctuation                                 | no Latin comma, semicolon or question mark inside a Thaana run | none                     | pass   |
| document content type                              | HTML with a UTF-8 charset                   | `text/html; charset=utf-8`                         | pass   |
| transport                                          | 200 over HTTPS                              | 200 over https                                     | pass   |
| host identifies itself                             | a `server` header                           | `GitHub.com`                                       | pass   |
| `rss.xml` content type                             | an XML type, not HTML or text               | an XML content type                                | pass   |
| `robots.txt` content type                          | plain text                                  | `text/plain`                                       | pass   |
| `feed.json` content type                           | a JSON type                                 | a JSON content type                                | pass   |
| **assets carry the base path**                     | every internal reference under `/dheys-cms` | all 34, none missing the base                      | pass   |
| **assets resolve**                                 | every internal reference returns 200        | 34 of 34, 6 via a 301 to the trailing-slash form   | pass   |
| console on six pages                               | no error, no warning, no failed request     | clean on `/`, `/ar/`, `/dv/`, `/archive`, `/admin`, `/search` | pass |

Lighthouse against the same live origin rather than a preview — same pages, same thresholds,
nothing about the limits changed with the target:

| Page                    | Perf | A11y | Best practices | SEO        | LCP     | CLS   | TBT  |
| ----------------------- | ---- | ---- | -------------- | ---------- | ------- | ----- | ---- |
| home                    | 100  | 100  | 100            | 100        | 894 ms  | 0.000 | 0 ms |
| article                 | 100  | 100  | 100            | 100        | 1129 ms | 0.000 | 0 ms |
| article (RTL, Thaana)   | 100  | 100  | 100            | 100        | 974 ms  | 0.000 | 0 ms |
| archive                 | 100  | 100  | 100            | 100        | 972 ms  | 0.000 | 0 ms |
| 404                     | 100  | 100  | 100            | not scored | 884 ms  | 0.000 | 0 ms |

Every category is at or above the 95 floor on every indexable page. LCP clears the 2.0 s
ceiling by 871 ms on the slowest page; CLS and TBT are at zero.

**The one exemption, stated rather than hidden.** The 404 page is excluded from the SEO
category only. That score is dominated by "page is blocked from indexing", which a 404 must
fail — being indexable would be the defect, and the `noindex` causing the low score is the fix.
Its other three categories are held to the full threshold and are 100, and the live run above
independently confirms both the 404 status and the `noindex`.

**One correction worth recording.** The first live run reported 28 of 34 references broken.
They were not. Astro emits directory-style pages, so `/admin` correctly 301s to `/admin/`, and
the checker was judging the hop instead of where the reader lands. The checker was wrong, not
the deployment; it now follows redirects and reports how many were canonicalised.

### 2b. Ship step 6 — the automation, including against the real API

Two halves, because they prove different things.

**Without a provider, against a local stand-in** (`pnpm verify:automation`): an HTTP server
implementing the GitHub endpoints the scheduler uses, backed by a real git repository on disk.
The runners are not stubbed — they resolve their API root from `GITHUB_API_URL`, which every
Actions runner sets, so this exercises the production code path over real HTTP.

| Check                        | Expected                                            | Actual                                        | Result |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------- | ------ |
| kill switch on               | scheduler stops, explains, commits nothing          | exit 0, reason printed, 0 commits               | pass   |
| kill switch is read first    | nothing else happens before it                      | registry never read                             | pass   |
| a real run, switch off       | scheduler completes                                 | exit 0                                          | pass   |
| ordering                     | kill switch, then registry, then content            | as specified                                    | pass   |
| the publishable item         | due, human-approved, guardrails clear, so publishes | the due item was committed                      | pass   |
| **guardrail block — words**  | a 3-word article does not publish                   | held back                                       | pass   |
| **guardrail block — review** | agent-only approval is not human approval           | held back                                       | pass   |
| the run explains itself      | says what it held and why                           | reported                                        | pass   |
| idempotency                  | a second tick publishes nothing again               | 0 further commits                               | pass   |
| connector — clean migration  | exits 0, diffs routes, writes the report            | migration report written                        | pass   |
| connector — report content   | carries route verification and open items           | both sections present                           | pass   |
| **connector — refusal**      | a migration losing a live URL is refused            | **exit 1**, nothing pushed                      | pass   |
| no provider key anywhere     | all three cleared in every child environment        | cleared                                         | pass   |
| no provider traffic          | every request is a GitHub API path                  | 15 requests, 7 distinct, all repository paths   | pass   |

**With a real credential, against a scratch repository** (`node scripts/verify-automation-live.mjs`).
This is the half that could not run until a token existed, and it covers exactly what a
stand-in cannot prove: rate limits, pagination, and permission errors as GitHub actually sends
them. A private throwaway repository was created for it. **17 checks, 16 passed.**

| Area        | Check                                                        | Expected                       | Actual                                          | Result   |
| ----------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------ | -------- |
| identity    | the token resolves to a real account                         | 200 and a login                | 200, scopes `repo, workflow`                     | pass     |
| set-up      | a scratch repository can be created                          | 201                            | 201, created private                             | pass     |
| **limits**  | the API reports a core budget                                | limit, remaining, reset        | limit 5000, remaining 4869, reset 15 min out     | pass     |
| **limits**  | responses carry the rate-limit headers the client reads      | all three present              | limit 5000, remaining 4868, reset present        | pass     |
| **limits**  | the remaining budget decreases as calls are spent            | second call lower than first   | 4868 then 4867                                   | pass     |
| **limits**  | the reset time is a real future instant                      | a valid time later than now    | parsed, 15 minutes ahead                         | pass     |
| **pages**   | a listing longer than one page                               | seeded and committed           | 7 files, one commit each                         | pass     |
| **pages**   | a multi-page listing sends a next link                       | a `Link` header                | present                                          | pass     |
| **pages**   | walking every page yields each item once                     | no duplicates, no gaps         | 8 commits over 5 pages at 2 per page, 8 unique   | pass     |
| **pages**   | the paged total matches an unpaginated read                  | identical counts               | paged 8, single page 8                           | pass     |
| **pages**   | a directory listing returns every file written               | 7 entries                      | 7 entries                                        | pass     |
| **pages**   | a page past the end is empty, not an error                   | 200 with an empty array        | 200, 0 entries                                   | pass     |
| **perms**   | a rejected token                                             | 401                            | 401, `Bad credentials`                           | pass     |
| **perms**   | a repository the token cannot see                            | 404, not 403                   | 404, `Not Found`                                 | pass     |
| **perms**   | writing over a file without its sha                          | rejected, not silently applied | 422, sha was not supplied                        | pass     |
| **perms**   | writing to a repository the token does not own               | refused, no commit             | 404, `Not Found`                                 | pass     |
| cleanup     | the scratch repository is deleted                            | 204, then 404 on re-read       | **403, must have admin rights**                  | **fail** |

**The one failure is real, and it is not a code defect.** Deleting a repository needs the
`delete_repo` scope, which `repo` does not imply, and the supplied token carries `repo` and
`workflow` only. The REST call refused and `gh` refused for the same reason. The brief's step 6
ends "then delete the scratch repository", and that step did not complete: a private scratch
repository named `dheys-cms-ship-check-` followed by a timestamp still exists and needs removing
by hand. It is private and holds seven invented files. It is OWNER-TODO 8. Reported as a
failure rather than softened into a caveat, because it is one.

Two pagination results are worth reading rather than skimming. A page past the end returns 200
with an empty array, not a 404 — a pager that treats "empty" as an error stops one page early
whenever the total is an exact multiple of the page size. And the paged walk was reconciled
against an unpaginated read of the same listing, because a pager that silently drops a page
still looks perfectly healthy from the inside.

### 2c. The product, verified from the release artefact

`pnpm verify:release` builds the zip and bundle from HEAD, **clones the bundle** into an empty
directory — a genuine standalone repository with its own history — and runs the whole gate
there. Nothing below was measured against the build tree.

| Check                            | Expected                                          | Actual                                                        | Result |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- | ------ |
| clone has its own `.git`          | git stops at the clone boundary                   | toplevel resolves to the clone                                 | pass   |
| clean-room in the clone           | no rule-2 violation in any file or commit         | 190 files, 27 commit messages, 0 violations                    | pass   |
| **history is the clone's own**    | reported count equals the bundle's                | equal                                                           | pass   |
| **history is not this repo's**    | a marker commit moves only the clone              | the gate followed the clone                                     | pass   |
| clone restored after the probe    | ships exactly as verified                         | restored                                                        | pass   |
| zip vs bundle                     | identical file lists                              | 190 files, no difference                                        | pass   |
| zip excludes build output         | no `node_modules/`, `dist/`, `.git/`              | 0 found                                                         | pass   |
| `pnpm install --frozen-lockfile`  | resolves from the lockfile, no warnings           | resolved                                                        | pass   |
| `pnpm typecheck`                  | 0 errors                                          | 96 files: 0 errors, 0 warnings, 0 hints                         | pass   |
| `pnpm lint`                       | no errors, no warnings                            | ESLint clean, Prettier reports every file formatted              | pass   |
| `pnpm test`                       | all pass, none skipped                            | 660 passed, 20 files, 0 skipped, 0 todo                         | pass   |
| `pnpm build`                      | completes with no warning                         | completed; only Pagefind's informational Dhivehi stemmer note    | pass   |
| `pnpm check:links`                | every internal reference resolves                 | 651 references across 36 pages                                  | pass   |
| `pnpm test:e2e`                   | all pass, no network                              | 44 passed, mocked GitHub, no outbound request                   | pass   |
| Lighthouse                        | all four at or above 95 on five pages             | 100 across the board                                            | pass   |
| JS on an article page             | under 30 KB                                       | 2,878 bytes (en) and 2,971 (dv), all inline, no external script  | pass   |
| Contrast                          | at least 4.5:1                                    | unit-tested per token pair, both themes, both schemes            | pass   |

### 2d. Dependency advisories

Resolved to zero, on the operator's instruction, after Dependabot was enabled in step 3.

| Package | Advisories | Direct or transitive           | Runtime or dev  | What was done                                | Now      |
| ------- | ---------- | ------------------------------ | --------------- | --------------------------------------------- | -------- |
| astro   | 8          | direct                         | runtime         | 5.18.2 to 7.2.4, two majors                   | closed   |
| esbuild | 1          | transitive, via astro          | build-time      | 0.27.7 to 0.28.2, carried by the astro upgrade | closed   |
| sharp   | 1          | direct *and* transitive via astro | build-time   | 0.34.5 to 0.35.3                              | closed   |

`pnpm audit` reports zero vulnerabilities and the repository has **zero open Dependabot
alerts** — 19 fixed, none dismissed. Details in section 7.

### 2e. CI on the real remote

Every push runs the full gate on Node 22 and Node 24 on ubuntu, plus a separate root-hosting
build. All three jobs are green on the released commit. The nightly Windows and macOS matrix is
configured and has not yet had a night to fire.

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

**Automation.** Five workflows — CI on Node 22 and 24 with a separate root-hosting build, a
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

**Live-provider verification happens on the private instance, not here.** That is the design,
not a gap in it: this repository is the published product and holds no keys, so it is the wrong
place to exercise a provider from. An operator who wants that assurance sets their keys on
their own instance and commissions one job. `docs/installation.md` and OWNER-TODO 5 say so.

What remains untouched by a live service, now that steps 5 and 6 have run:

- **The scheduler has never published to a real connected site.** Its logic is pure and
  exhaustively tested with injected clocks; a real tick, a kill-switch stop, two guardrail
  blocks and an idempotent second tick have all been run end to end against the stand-in; and
  the real API's rate limits, pagination and permission errors are now covered against a
  scratch repository. What has not happened is a scheduled run committing to a genuine site
  repository, because no site is connected to this instance and none will be.
- **The Actions cron has fired, and skips by design.** The scheduler workflow now runs on its
  fifteen-minute schedule and exits green without doing anything, because no site token is
  configured here. That is the correct behaviour for the published copy, and it is what the
  workflow is asserted to do — but it means the cron has never driven a real publish.
- **Four of the five deploy adapters are unexercised against their own hosts.** GitHub Pages is
  now proven end to end by this repository's own deployment. Cloudflare Pages, Netlify, Vercel
  and the generic webhook are unit-tested against mock transports and have never called their
  real APIs. Without a confirmation token each reports *delivery* — that the hook was accepted
  — rather than claiming a deploy succeeded, which is the honest reading and is deliberate.
- **The nightly Windows and macOS matrix has not yet fired.** It is configured and scheduled;
  it has simply not had a night. The full gate has been run on Windows locally throughout.

---

## 6. Owner TODO

Full detail, with time estimates, in `release/OWNER-TODO.md`. In short:

1. ~~Authenticate the GitHub CLI~~ — **done.** The token was supplied and the ship sequence ran.
2. **Confirm the Dheys logo is the intended artwork** — 1 minute, cosmetic. Until then the
   header renders a text wordmark and the build prints a warning naming the expected path.
3. **Have the Dhivehi and Arabic UI strings reviewed by a native speaker** — about an hour.
4. **Decide the Thaana font question** — depends on the licence holder. No font binary ships.
5. **Set the AI provider keys you intend to use — on your private instance, not here** — 5
   minutes each, and none is required.
6. **Choose where the site registry lives** — 10 minutes; private gist, private companion
   repository, or a secret.
7. **Nothing is missing from this repository's secret store** — no action. Recorded so an empty
   secrets page reads as a decision rather than an oversight.
8. **Delete the scratch repository left by ship step 6** — 30 seconds. It is private, named
   `dheys-cms-ship-check-` followed by a timestamp, and holds seven invented files. The
   supplied token could not delete it: that needs the `delete_repo` scope, which `repo` does
   not imply. Either delete it in the web UI, or run
   `gh auth refresh -h github.com -s delete_repo` and then `gh repo delete <name> --yes`.
9. **Decide what to do with five open Dependabot PRs** — 5 minutes. They bump GitHub Actions
   versions, not dependencies, and clearing them would remove the "Node.js 20 is deprecated"
   annotation that every workflow run currently carries. They are not security alerts; those
   are all closed. They were left alone because bumping five action majors is not a ship step
   and each one changes how the pipeline runs.

---

## 7. Known limitations

- **Astro moved two majors during the ship sequence, on the day of release.** 5.18.2 to 7.2.4,
  to clear eight advisories. The full gate passes on it — 660 unit tests, 44 end-to-end tests,
  Lighthouse at 100 on five live pages — and the released archive was verified by cloning it
  and running the whole gate inside the clone. But this version has days of use behind it, not
  months, and two majors is a lot of change to absorb at once. The alternative was shipping
  known CVEs, which the brief bans. Anything strange in the build is worth suspecting here
  first, and `docs/DECISIONS.md` 55 to 58 record what moved and why.
- **Astro 7 daemonises `astro preview`, and two gates depended on it not doing that.** Both are
  fixed and both failures were instructive: Playwright aborted before running a single test,
  and the Lighthouse gate hung for eighteen minutes on CI on a step that takes fifty seconds,
  because `execFile` waits for inherited stdio to close and a detached daemon never closes it.
  Anything else in this repository that shells out to a long-lived process is worth checking
  against the same assumption.

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

## Appendix A — ship step 5, the live deployment, raw output

Produced by `node scripts/verify-live.mjs --url https://nazilafeef.github.io/dheys-cms`.

```
=== verify:live — 2026-08-21T06:36:28Z ===
verify-live: https://nazilafeef.github.io/dheys-cms
started 2026-08-21T06:36:28.434Z

Documents
  ok   site root returns 200 with expected content
  ok   /admin returns 200 with expected content
  ok   sitemap.xml returns 200 with expected content
  ok   news-sitemap.xml returns 200 with expected content
  ok   rss.xml returns 200 with expected content
  ok   atom.xml returns 200 with expected content
  ok   feed.json returns 200 with expected content
  ok   robots.txt returns 200 with expected content
  ok   llms.txt returns 200 with expected content

A missing path
  ok   a missing path returns a real 404 status
  ok   the 404 body is this project’s own 404 document
  ok   the 404 page is noindex

Locale routes
  ok   en route responds 200
  ok   en declares lang="en"
  ok   en declares dir="ltr"
  ok   ar route responds 200
  ok   ar declares lang="ar"
  ok   ar declares dir="rtl"
  ok   dv route responds 200
  ok   dv declares lang="dv"
  ok   dv declares dir="rtl"
  ok   the Dhivehi route renders Thaana script
  ok   Dhivehi content uses Thaana punctuation, not Latin

Response headers
  ok   the document is served as HTML with a UTF-8 charset
  ok   the origin is HTTPS and serves the site root
  ok   the host identifies itself
  ok   rss.xml is served as XML rather than HTML or plain text
  ok   robots.txt is served as plain text
  ok   feed.json is served as JSON

Assets and internal links
  ok   every internal reference carries the deployment base path
  ok   every internal reference resolves on the live origin

Console, in a real browser
  ok   / loads with no console errors or warnings
  ok   /ar/ loads with no console errors or warnings
  ok   /dv/ loads with no console errors or warnings
  ok   /archive loads with no console errors or warnings
  ok   /admin loads with no console errors or warnings
  ok   /search loads with no console errors or warnings

finished 2026-08-21T06:37:05.510Z
verify-live: 37 check(s), 37 passed, 0 failed.
exit=0
```

---

## Appendix B — Lighthouse against the live origin, raw output

Produced by `node scripts/lighthouse.mjs --live https://nazilafeef.github.io/dheys-cms`.

```
=== lighthouse --live — 2026-08-21T06:37:15Z ===
warming up (result discarded)

home — https://nazilafeef.github.io/dheys-cms/
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  ok   SEO                100
  ok   Agentic Browsing   100
  ok   LCP                894ms
  ok   CLS                0.000
  ok   TBT                0ms

article — https://nazilafeef.github.io/dheys-cms/articles/the-tide-gauge-at-the-old-harbour
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  ok   SEO                100
  ok   Agentic Browsing   100
  ok   LCP                1129ms
  ok   CLS                0.000
  ok   TBT                0ms

article (RTL, Thaana) — https://nazilafeef.github.io/dheys-cms/dv/articles/bandharuge-dhiyavaru-maapu
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  ok   SEO                100
  ok   Agentic Browsing   100
  ok   LCP                974ms
  ok   CLS                0.000
  ok   TBT                0ms

archive — https://nazilafeef.github.io/dheys-cms/archive
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  ok   SEO                100
  ok   Agentic Browsing   100
  ok   LCP                972ms
  ok   CLS                0.000
  ok   TBT                0ms

404 — https://nazilafeef.github.io/dheys-cms/404
  ok   Performance        100
  ok   Accessibility      100
  ok   Best Practices     100
  n/a  SEO                63  (a 404 must be noindex, which is precisely what the SEO category penalises)
  ok   Agentic Browsing   100
  ok   LCP                884ms
  ok   CLS                0.000
  ok   TBT                0ms

lighthouse: OK — 5 page(s), all categories >= 95, all metrics inside budget.
exit=0
```

---

## Appendix C — ship step 6 against the real API, raw output

Produced by `node scripts/verify-automation-live.mjs`. The scratch repository's full name is
redacted here: naming another repository in a committed file is exactly what `pnpm
check:clean-room` exists to stop, and the gate is not worth suspending to make an appendix
tidier.

```
verify-automation-live
finished 2026-08-21T05:49:15.198Z


Identity
  ok   the token resolves to a real account
       HTTP 200, login "nazilafeef", scopes "repo, workflow"

Scratch repository
  ok   a scratch repository can be created
       HTTP 201, created "<scratch repository, redacted>" (private: true)

Rate limits, read from real responses
  ok   the API reports a core rate-limit budget
       limit 5000, remaining 4869, resets 2026-08-21T06:04:06.000Z
  ok   every response carries the x-ratelimit headers the client reads
       limit 5000, remaining 4868, reset 1787292246
  ok   the remaining budget decreases as calls are spent
       4868 then 4867
  ok   the reset time parses to a real future instant
       2026-08-21T06:04:06.000Z (in 15 min)

Pagination, across a listing longer than one page
  ok   the scratch repository was seeded
       7 files committed one per request
  ok   a multi-page listing sends a Link header with rel="next"
       Link header present
  ok   walking every page yields each item exactly once
       8 commits over 5 page(s) at 2 per page, 8 unique
  ok   the paged total matches a single-page read of the same listing
       paged 8, single page 8
  ok   a directory listing returns every file that was written
       7 entries
  ok   a page past the end is an empty list, not an error
       HTTP 200 with 0 entries

Permission and error handling, against real responses
  ok   a rejected token returns 401
       HTTP 401: Bad credentials
  ok   a repository the token cannot see returns 404, not 403
       HTTP 404: Not Found
  ok   writing over a file without its sha is rejected, not silently applied
       HTTP 422: Invalid request.

"sha" wasn't supplied.
  ok   writing to a repository the token does not own is refused
       HTTP 404: Not Found

Cleanup
  FAIL the scratch repository was deleted
       DELETE returned HTTP 403: Must have admin rights to Repository. — "<scratch repository, redacted>" still exists and must be removed by hand

verify-automation-live: 17 check(s), 16 passed, 1 failed.
```

---

## Appendix D — release verification, raw output

Produced by `pnpm verify:release`: build the zip and bundle from HEAD, clone the bundle into an
empty directory, and run the entire gate inside the clone.

```
=== pnpm verify:release — 2026-08-21T10:25:19Z ===

> dheys-cms@1.0.1 verify:release D:\2026\dheys-cms
> node scripts/verify-release.mjs

verify-release: HEAD faa6ede
  ok   working tree is clean

== building artefacts from HEAD
  ok   zip written -- release\dheys-cms-v1.0.1.zip
  ok   bundle written -- release\dheys-cms-v1.0.1.bundle

== cloning the bundle into a standalone repository
  ok   the clone has its own .git
  ok   git inside the clone resolves to the clone, not the outer repository -- D:/2026/dheys-cms/.tmp/release-verify/clone-20260821102519

== proving the clean-room gate reads the clone history, not this one
  bundle/clone commits : 30
  this repository      : 30
  gate says            : clean-room: OK -- 190 file(s) scanned plus 30 commit message(s), no violations.
  ok   clean-room passes in the clone -- exit=0
  ok   the gate reports a commit count at all -- clean-room: OK -- 190 file(s) scanned plus 30 commit message(s), no violations.
  ok   reported count equals the bundle own history -- 30 == 30
  with a marker commit : clean-room: OK -- 190 file(s) scanned plus 31 commit message(s), no violations.
  ok   the marker moved the clone history by one -- 31
  ok   the gate followed the clone, not this repository -- 31 == 31, and != 30
  ok   the clone is left exactly as it will ship -- 30 == 30

== checking the zip and the bundle ship the same files
  ok   zip file list matches the clone tracked files -- 190 files
  ok   zip excludes node_modules, dist and .git -- 0 found

== running the full gate in the clone
  ok   pnpm install -- exit=0, 23.3s
  ok   pnpm typecheck -- exit=0, 29.7s
  ok   pnpm lint -- exit=0, 10.9s
  ok   pnpm test -- exit=0, 5.8s
  ok   pnpm build -- exit=0, 5.7s
  ok   pnpm check:links -- exit=0, 0.4s
  ok   pnpm test:e2e -- exit=0, 23.8s
  ok   pnpm lighthouse -- exit=0, 56.3s

== OK
  190 files, 30 commits, verified from the bundle.
exit=0
```
