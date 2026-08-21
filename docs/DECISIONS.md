# Decisions

One line per judgement call the brief did not settle, in the order they were made. The
point of this file is that a later reader can tell what was chosen deliberately from what
merely happened.

## Slice 1 — skeleton, config, base path, CI, clean-room gate

1. **`gh` was not installed on the build machine.** The brief's preflight stops only for an
   _unauthenticated_ `gh`. Absent is a different thing and installing a dependency is
   explicitly authorised, so `gh` was installed via winget rather than treated as a stop.
   `gh` was still unauthenticated afterwards, which is a genuine stop for ship steps 2–6
   only; slices 1–17 are entirely local and proceeded.
2. **`pnpm` was installed with `npm install -g pnpm@10`, not corepack.** `corepack enable`
   needs write access to the Node install directory under `Program Files` and failed with
   `EPERM`. The global install lands in the user profile and needs no elevation.
3. **`astro.config.ts`, not `astro.config.mjs`.** The config needs `normaliseBase` from
   `src/lib/paths.ts` so the build and the rendered markup cannot disagree about what the
   base path is. A `.mjs` config cannot import a `.ts` module cleanly; a `.ts` config can.
4. **A doubled slash is a path, not an origin.** `withBase` treats `//host/x` as external
   only when the first segment contains a dot. `//about` is a malformed in-app path and is
   repaired rather than silently turned into a link to another origin.
5. **Bare hostnames are not scanned inside source files.** `schedule.at`, `record.to`,
   `actor.id` and `admin.nav.media` are member expressions and i18n keys whose suffixes are
   all real public suffixes (`.at`, `.to`, `.id`, `.media`). The first full run produced
   pages of noise. Detection is now: scheme- or `@`-anchored hosts everywhere,
   `www.`-prefixed hosts everywhere, and bare hosts in prose files and JSON _values_ only.
   **Residual gap, stated plainly:** a hostname hard-coded bare, with no scheme and no
   `www.`, inside a source-file string literal would not be caught. Every other form is,
   and all site configuration in this project lives in YAML/JSON/Markdown, which are
   scanned in full.
6. **JSON keys are structure, not content.** Only the value side of a JSON line is scanned
   for bare hostnames, because every i18n message key is dotted by design.
7. **The "assigned secret" credential rule is entropy-guarded.** Matching
   `key: "…"` on length alone flagged CSS class names and slugs. A match must now mix three
   of four character classes, or be a long unbroken base64 run. `"article-list-item"`
   passes; `"j4Kd82nfLp0qWzXcVbNm55aa"` does not.
8. **Clean-room test fixtures are assembled at runtime.** If the planted violations were
   written as literals, the file proving the gate works would itself fail the gate. The
   strings exist only in memory while the test runs.
9. **Thaana fili are written as `\uXXXX` escapes.** They are combining marks: invisible in
   an editor, invalid as bare object keys, and altered by anything that normalises Unicode.
10. **`pnpm.onlyBuiltDependencies` is set for `esbuild` and `sharp`.** The gate requires an
    install with no warnings, and pnpm 10 warns about ignored build scripts until the
    allowed set is declared.

## Slice 2 — registry, schemas, adapters

11. **Affiliate disclosure is materialised into frontmatter, not resolved at render time.**
    The rule is that an item carrying an affiliate offer cannot publish without a
    disclosure. Resolving a default at render would make that always trivially true. Storing
    the text means git history records what was disclosed alongside what was published.
12. **Provenance is built from the dispatch record, never from the model's output.** Run id,
    timings, token counts and cost come from the runner's own accounting. An agent is not
    trusted to report what it cost.
13. **Model rates ship for Anthropic models only.** Those are published rates and are in
    `DEFAULT_MODEL_RATES` as a fallback. Rates for other providers are deliberately absent
    rather than guessed: an unpriced model estimates at the job's own `maxCostUsd` ceiling,
    so it is treated as expensive rather than invisible. Sites can override any rate.
14. **Dhivehi and Arabic UI strings were written during the build and have not been reviewed
    by a native speaker.** They are complete and structurally correct; the wording needs a
    pass. Recorded as OWNER-TODO 3 rather than shipped as English placeholders, because a
    missing translation is a worse default than an imperfect one.

## Slice 3–5 — routing, front end, SEO, feeds, themes, search

15. **The default locale lives at the root, the others are prefixed.** Routes are
    `[...locale]` rest parameters, so English is `/articles/x` and Dhivehi is
    `/dv/articles/x`. The alternative — prefixing every locale — is tidier to implement and
    worse for the reader who only ever wants one language. The rest parameter is what makes
    both shapes come out of a single route file.
16. **Collection ids are locale-aware.** Three `about.md` files exist, one per language, and
    Astro's default id is the filename stem, so they collided and two silently vanished.
    `generateId` now includes the locale directory. Discovered by a build that produced one
    About page instead of three.
17. **Slug generation transliterates Arabic as well as Thaana.** Without it every
    Arabic-titled author fell through to `untitled`, so two authors collided on one page.
    Transliteration is lossy and deliberately so — a slug is an identifier, not a
    translation.
18. **Heading anchors keep combining marks.** `headingSlug` originally stripped everything
    outside `\p{L}\p{N}`, which removes every Thaana fili, because fili are `\p{M}`. Dhivehi
    headings collapsed to their consonant skeletons and every Dhivehi table-of-contents link
    pointed at nothing. The class now includes `\p{M}`.
19. **`hreflang` and the language switcher take a real URL per locale, not a shared slug.**
    Translations have their own slugs — that is the point of transliterating titles — so
    deriving a sibling URL by swapping the locale prefix produces links to pages that do not
    exist. The resolved URLs are computed once from the translation family and threaded
    through `BaseLayout` → `SiteHeader` → `LocaleSwitcher` and `SeoHead`.
20. **The brand logo is read from `process.cwd()`, not `import.meta.url`.** Under
    `import.meta.url` the path resolves into the build output rather than the source tree,
    so the file was never found and every built page silently fell back to the text
    wordmark. The site looked fine, which is exactly why it went unnoticed until the file
    itself was checked.
21. **Search is Pagefind, indexed at build time.** It is the only full-text option that
    needs no server and no third-party index, which the no-backend constraint requires.
    Pagefind has no stemmer for Dhivehi and says so during the build; matching is exact-word
    for `dv`, and that is written down in `docs/troubleshooting.md` rather than hidden.
22. **The RSS assertion checks for `xml`, not an exact content type.** The endpoint sets
    `application/rss+xml`, but on a static host the header comes from the host, and GitHub
    Pages serves `.xml` as `text/xml`. Asserting the value the code sets would test the dev
    server rather than the artefact readers actually receive.

## Slice 6–10 — editorial machine, admin editor, review queue

23. **`hasHumanApproval` is false for `agent` and `system` actors.** The transition map alone
    would let an agent move its own draft to `approved`. The actor class is checked
    separately from the transition, so no arrangement of states lets non-human approval
    stand in for human approval.
24. **The admin holds its token in `sessionStorage` and nothing else.** The reasoning, and
    the honest cost of it, is written out at the top of `src/lib/admin/session.ts` and again
    in `docs/SECURITY.md`. Short version: no server means no `httpOnly` cookie, so the
    mitigations are scope and session lifetime, plus a documented GitHub App path for
    operators who want the credential out of the browser entirely.
25. **`human-review-required` is evaluated at publish time only.** Evaluated in the review
    queue it is circular: the rule that a human must approve fails until a human approves,
    which disables the approve button, so no site carrying the rule could ever publish
    anything. `PUBLISH_TIME_ONLY` names the rules the queue must skip and `reviewTimeRules()`
    is what the queue calls.
26. **The review queue computes the real translation family.** It was passing the site's full
    locale list as "available", which made the locale-completeness rule structurally
    unfailable — it compared a list against itself. It now resolves which translations
    actually exist.
27. **Word counts treat combining marks as part of the preceding word.** `\p{L}`-only
    counting scored a two-word Dhivehi phrase as five, so the minimum-word guardrail
    over-counted Dhivehi by roughly two and a half times and passed articles a third of the
    intended length. The same bug and the same fix as the heading anchors, found separately.
28. **A guardrail result keeps every reason.** The auto-publish path was overwriting the
    substantive reason with the scheduling message, so the record said _when_ something
    published and lost _why_ it was allowed to.

## Slice 11–14 — providers, scheduler, cost, automation

29. **The Anthropic provider carries a hand-written JSON Schema.** The SDK's Zod helper
    targets Zod 4; Astro's content layer pins Zod 3, and the item schema is shared with the
    content layer. Two Zod majors in one dependency graph is worse than one schema written
    twice, so `GENERATED_ITEM_JSON_SCHEMA` is maintained beside the Zod schema and a test
    asserts the two agree on the required-field set.
30. **Structured output at generation time does not replace validation at ingest time.**
    `messages.parse` constrains the response to the schema and the result still goes through
    `intake()`. A constraint on one provider is not a guarantee about all of them, and the
    webhook provider accepts output from code this project never sees.
31. **Every transport is injected.** Providers, the GitHub client and the scheduler all take
    a `fetchImpl`. "No test calls a real AI provider or the real GitHub API" is then a
    property of the wiring rather than a rule tests are trusted to follow — a test that
    wanted to reach the network would have to be handed something that could.
32. **Scheduling is seeded-deterministic, not random.** `tick()` is pure and the jitter comes
    from xmur3 + mulberry32 seeded on the job id, so the same tick computed twice produces
    the same plan and a re-run cannot double-publish. Missed windows are caught up rather
    than skipped, because a runner that was down for six hours should not silently drop a
    day's schedule.
33. **An unpriced model estimates at the job's own ceiling.** Extends decision 13: guessing a
    rate would under-report and hide spend, so an unknown model is treated as costing the
    maximum the job is allowed to spend. Visible and conservative instead of invisible.

## Slice 15–17 — end-to-end tests, performance gate, connector, docs

34. **`test:e2e` builds explicitly rather than relying on a `pre` script.** pnpm does not run
    `pre`/`post` lifecycle hooks. The suite was passing against a stale bundle — the worst
    possible failure mode for a gate, since it reports green about code that no longer
    exists.
35. **Chrome's location is discovered, not hard-coded.** The Lighthouse runner finds the
    Playwright-managed browser by scanning the install root, because the directory is
    `chrome-win64` on some versions and `chrome-win` on others, and a hard-coded path turns a
    working machine into a broken gate.
36. **The Lighthouse gate discards one warm-up run.** Total Blocking Time measured 157 ms
    cold and 70 ms warm on the same artefact; the variance is harness warm-up, not the page.
    One discarded run and then the measured one — not a retry loop, and not a threshold moved
    to accommodate a flake.
37. **The 404 page is exempt from the SEO category only, with the reason recorded.** That
    score is dominated by "page is blocked from indexing", which a 404 fails by design and
    should fail. Performance, accessibility and best practices are still enforced on it at
    the full threshold. The exemption is per-page and carries a written reason.
38. **The link checker is run in root-hosting mode from PowerShell.** Git Bash rewrites a
    lone `/` argument into a Windows path, so the root-mode run was checking a nonsense base
    and passing. Both hosting modes are checked, and the shell that can actually express the
    argument is used for the one that needs it.
39. **The clean-room gate scans the working tree, not the index.** It used `git ls-files`,
    which lists tracked files only, so a newly written file was invisible to the gate until
    after it had been committed — precisely backwards. `--cached --others --exclude-standard`
    took the scanned set from 53 files to 124 at the time, and 181 now.
40. **GitHub Actions expressions are stripped before the bare-hostname scan.** An
    `inputs.site` expression reads as a hostname because `.site` is a real gTLD. Fenced code
    blocks in Markdown are likewise excluded from prose scanning, after member expressions
    inside documentation examples were reported as domains.
41. **The repository-reference rule knows the API path shape.** A `repos/{owner}/{repo}` API
    URL parsed `repos` as the owner and passed. The pattern now accounts for that segment,
    and the allowed-owner set is explicit rather than a side effect of a parse failure.
42. **Two third-party hostnames are allowlisted.** The Anthropic domain appears in the
    `Co-Authored-By` trailer on every commit in this history and in SDK documentation links;
    the JSON Schema domain is a dialect URI. Neither connects the repository to the operator,
    which is what rule 2 exists to prevent.
43. **`@astrojs/check` is a real dependency.** Without it `astro check` prompts to install
    itself and waits for an answer, so `pnpm typecheck` would have hung in CI rather than
    failing. Installing it also surfaced five genuine hints that `tsc --noEmit` alone never
    reported; all five are fixed and the gate now requires zero hints, not merely zero
    errors.
44. **ESLint's `consistent-type-imports` is scoped to `.ts`/`.tsx`/`.mts`.** It crashes on
    `.astro` files, whose frontmatter its fixer cannot rewrite safely. Astro files are still
    linted, through `astro-eslint-parser`, by every rule that works on them.
45. **Test fixtures for unvalidated input are typed `Record<string, unknown>`.**
    `z.coerce.date()` narrows the schema's input type to `Date`, so a fixture typed from the
    schema could not express the string date an unvalidated item actually arrives with. The
    fixtures are raw input and are now typed as raw input.

## Slice 18 — packaging and the report

46. **The release archive is verified by cloning the bundle, not by unzipping the zip.**
    _(Superseded the original entry; see the note below for what it used to say.)_ The brief
    forbids creating working copies anywhere else on disk, so verification has to happen
    inside this working directory. A zip carries no `.git`, so an unpacked copy sitting in
    `.tmp/` had no history boundary of its own and every git-aware check resolved upward:
    the clean-room gate read _this_ repository's commit history while reporting on the
    archive. The file scan was sound — `git ls-files` returns nothing in an ignored
    subdirectory, so the gate fell through to its filesystem walk and covered exactly the
    archive's files — but the history half was reading something else.

    **Resolved.** A bundle _is_ history, so `pnpm verify:release` clones
    `release/dheys-cms-v1.0.0.bundle` into `.tmp/release-verify/clone`, which is a genuine
    standalone repository: git stops at its boundary and borrows nothing from the enclosing
    tree. The proof is an assertion rather than an argument — the commit count the gate
    reports must equal the clone's own, and once this repository has moved past the bundle
    (the normal state, since packaging is followed by committing the report) reading the
    wrong history becomes detectable by number. `tests/unit/release-verify.test.ts` pins it
    deterministically against a synthetic three-commit repository, a count this repository
    can never have again. The zip is still checked, by asserting its file list matches the
    clone's tracked files exactly, so the two artefacts cannot disagree about what ships.

47. **The clean-room gate distinguishes "history clean" from "no history".** It returned an
    empty violation list for both and printed "plus commit history" either way, so run against
    an unpacked archive it would have certified a history it never opened. It now reports the
    number of commit messages actually read, or says there is no history to read. Two tests
    cover it; the negative one was confirmed to fail when the distinction is removed. Found
    while verifying the release archive — which is the argument for verifying the artefact
    rather than the tree it came from.
48. **`.tmp/` belongs in every ignore list, not just `.gitignore`.** It was ignored by git and
    skipped by the clean-room gate, but ESLint and Prettier both walked into it, so an
    unpacked archive was linted as project source and reported 205 errors in files that are
    not this project's to lint. A directory that is invisible to one tool and not another is
    a trap for whoever hits it next.

## Amendments — public/private split, bundle verification, provider-free step 6

49. **This repository's Actions secret store stays empty, permanently.** The operator runs a
    separate private instance that holds every key and the site registry; this copy is the
    published product. No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` was read
    from the environment during the build, requested, or written anywhere. The split is
    documented in `README.md` and `docs/installation.md` from the reader's side, and recorded
    as OWNER-TODO 7 so an empty secrets page reads as a decision rather than an unfinished
    step. Deploying to Pages needs no secret: the workflow uses the built-in `GITHUB_TOKEN`.
50. **The scheduler, guardrails, kill switch and connector are verified without a provider.**
    None of the four calls a model: the scheduler decides _when_, the guardrails decide
    _whether_, the kill switch decides _if at all_, and the connector moves files that already
    exist. Where a step in the automation would reach a provider, the mock transport stands in
    and the report says so at that point rather than in a footnote.

## Ship — steps 2 to 7 against the live remote

51. **The supported Node floor is 22.19, not 20.11, and CI runs 22 and 24.** The brief asks
    for latest-stable Astro and a gate on Node 20 and 22. Those two stopped being compatible:
    `astro@5.18.2` pulls `unifont@0.7.5`, which declares `undici: ^8.0.0`, and `undici@8.10.0`
    sets `engines.node: >=22.19.0`. The Node 20 gate therefore failed at `pnpm install` with
    `ERR_PNPM_UNSUPPORTED_ENGINE` before running a single check — the first push to the live
    remote is what surfaced it, because every local run had been on 22.23. Overriding undici
    down to 7 would contradict unifont's own declared range, and pinning Astro backwards
    would forfeit the brief's "latest stable". Of the readings available, the one that serves
    a first-time forker is the honest floor: on Node 20 `pnpm install` cannot succeed whatever
    this repository claims, so claiming 20 buys nothing and costs a failed first command. The
    brief's own conflict rule applies. `engines.node`, `.nvmrc` (now pinned to `22.19.0`
    exactly, since a bare `22` can resolve below the floor) and every prose claim were moved
    together; `docs/BUILD-BRIEF.md` is left alone, being a historical document.
52. **Nothing was written to this repository's Actions secret store, by instruction and by
    decision 49.** Ship step 3 otherwise ran in full: Pages source set to GitHub Actions,
    `DHEYS_PUBLISHING_HALTED` set to `false` and `COST_LEDGER_PATH` to its documented default
    as repository _variables_, and Dependabot alerts and security updates enabled. The secrets
    page is empty and is meant to stay that way.
53. **The first Pages deploy failed, and the cause was ordering rather than the workflow.**
    Pushing `main` triggered `deploy.yml` about a minute before Pages had been enabled, so
    `actions/configure-pages@v5` got a 404 from the Pages API and stopped the build. Enabling
    Pages first and re-dispatching the same workflow, unchanged, ran green. Recorded because
    the failed run stays visible in the Actions history and reads like a broken pipeline
    otherwise: ship steps 3 and 4 are ordered for a reason.

54. **The clean-room history scan reads `HEAD`, not `--all`.** Turning Dependabot on in ship
    step 3 put branches in the repository whose commit messages quote upstream release notes,
    foreign repository references and all, and CI checks out with `fetch-depth: 0` — so the
    gate read them and failed the build with 22 violations in commits no human wrote and
    nothing ships. Two readings were available: exempt bot authors, or scan what is actually
    under test. The second is better, because a gate whose verdict depends on which side
    branches exist at the moment it runs is not reproducible, and reproducibility is most of
    what a gate is for. `pnpm check:clean-room` locally and the same command in CI now agree
    by construction. Proven in both directions: a violation reachable only from a side branch
    is ignored, and the same message on `HEAD` still fails — the negative case being the one
    that matters, since scoping to HEAD would also "pass" if the scan had silently stopped
    reading anything.
55. **Astro went from 5.18.2 to 7.2.4, two majors, to clear eight advisories.** ~~Recorded,
    not fixed~~ — superseded on the operator's instruction to resolve every Dependabot alert
    and to treat a required major as work to be done rather than a reason to skip. The
    binding constraint was GHSA-4g3v-8h47-v7g6, patched in 7.1.0; the other seven were
    satisfied by anything at or above 6.4.6. Every advisory is an XSS or SSRF in a
    server-rendered path this static build never executes, so the real exposure was low —
    but "not exploitable here" is an argument for calm, not for shipping a known CVE, which
    the brief bans outright. `esbuild` (GHSA-g7r4-m6w7-qqqr) came along transitively: Astro 7
    pulls 0.28.2, above the 0.28.1 fix, so no override was needed. `pnpm audit` reports zero
    vulnerabilities afterwards.

56. **The `sharp` override was removed once it stopped doing anything.** It existed because
    `astro@5.18.2` declared `sharp: ^0.34.0` and would have kept a second, vulnerable copy
    beside the patched one. Astro 7 declares `^0.34.0 || ^0.35.0`, so a single 0.35.3
    resolves for everyone without being pinned. A version pin that no longer changes the
    resolution is a maintenance cost with no benefit, and the next person to read it would
    reasonably assume it was load-bearing.
57. **Astro 7 daemonises `astro preview`, which broke two gates in different ways.** The
    command now forks and exits 0 immediately. Playwright's `webServer` saw its process
    leave and aborted the whole suite with "exited early" before running a test; the
    Lighthouse gate called `.kill()` on an already-exited process and left a real server
    listening afterwards, which would have served a stale build to whatever ran next. Both
    now go through `scripts/preview-control.mjs`, which starts the daemon, waits for the URL
    to actually answer rather than trusting the CLI's output, and stops it through Astro's
    own `preview stop` — the pid that needs killing is not the one we spawned. A
    `globalTeardown` stops it as well, because on Windows Playwright terminates its web
    server without giving it the chance to run an exit handler.
58. **v1.0.0 was never published, so the first published release is v1.0.1.** The release
    archives had been built and gated against the pre-upgrade tree, which is the tree
    carrying the eight advisories. Publishing that as v1.0.0 and superseding it minutes
    later would have put a knowingly-vulnerable artefact on the releases page for no reason:
    nobody had downloaded it, because it had never existed there. The version moves to 1.0.1,
    the archives are rebuilt from the fixed tree, and `CHANGELOG.md` records both — 1.0.0 as
    the build that was completed, 1.0.1 as the security upgrade that shipped.

59. **The scheduler skips instead of failing when no site token is configured.** The cron
    fired fifteen minutes after the first push and failed, and would have failed every
    fifteen minutes thereafter, because `DHEYS_SITE_TOKEN` is deliberately absent from this
    repository (decision 49) and the runner correctly refuses to start without it. Two
    normal situations have no token — the published copy, permanently, and any fork nobody
    has configured yet — and in both the honest answer is that there is no work to do, not
    that something is broken. A job-level guard skips the run, which costs no runner minutes
    and leaves the history green; a token that is present but wrong still fails loudly. The
    alternative, a repository whose scheduler is always red, teaches every reader to ignore
    the one signal that matters when a real tick breaks. The guard is a first _step_ rather
    than a job-level `if:`, because the `secrets` context is not available in one — written
    there it passes every editor and linter and is then rejected by GitHub at dispatch time
    as a zero-second run named after the workflow file, which is a confusing way to find
    out. Corrected after doing exactly that.

## v1.0.2 — a nullish check that could not see "empty"

69. **`estimateCost` merged the rate tables instead of replacing them, and the bug was found
    by running the thing rather than reading it.** The expression was
    `input.rates ?? DEFAULT_MODEL_RATES`, and `siteAgentConfigSchema` defaults
    `agents.modelRates` to `{}`. An empty object is not nullish, so `??` kept it: the shipped
    table was never consulted, `rateKnown` was false for every model, and every job was
    priced at `fallbackUsd` — its ceiling.

    This is not cosmetic. The monthly cap is enforced against these estimates, so a $25 cap
    admitted 25 jobs whatever they actually cost, and the ledger's relationship to real
    spend was decided by a `??`. A live agent run on a private instance reported "model has
    no known rate" for `claude-opus-5` and estimated the full $1.00 ceiling for what should
    have cost a fraction of a cent — which is how it was noticed, after passing review and a
    full test suite.

    Merging keeps all three intended behaviours: shipped models price correctly, a site
    overrides any rate it disagrees with, and a genuinely unknown model still falls through
    to the ceiling rather than being treated as free. Two regression tests cover it, and each
    was watched failing against the old expression before being kept — the second matters
    most, because a site override that _replaced_ rather than merged would still have priced
    its own model correctly while silently unpricing every other one.

70. **The audit for the same shape found one more class of it, in the environment.** The
    question was: where else can the left side of a `??` be _present but empty_? Across
    `src/` and `scripts/`, `estimateCost` was the only instance of the schema-default form —
    every other `??` over a collection either falls back to an equally empty value
    (`options.sources ?? []`), tests length explicitly, or reads a Map where a miss really is
    `undefined`. `guardrailsFor` is the contrast worth naming: it already writes
    `site.guardrails.length > 0 ? site.guardrails : DEFAULT_GUARDRAILS`, which is exactly
    what `estimateCost` should have done.

    The environment is the other place a value arrives empty rather than absent.
    `${{ secrets.X }}` and `${{ vars.X }}` expand to the **empty string** when unset — a
    real run's log shows `EXTERNAL_AGENT_TOKEN:` with nothing after it — so
    `env['X'] ?? fallback` hands back `''` and the default never fires. Four sites had it:
    the Anthropic, OpenAI and Gemini model names, which would have become empty model
    strings, and the two external-agent timeouts, where `Number('')` is `0` — a zero
    timeout, which fails instantly rather than obviously.

    `envOr` in `src/lib/runner-env.ts` now treats empty as absent, with three tests. The
    hazard is worth stating once in general terms: `??` distinguishes _missing_ from
    _present_, and a surprising number of sources — Zod defaults, Actions expressions, form
    fields, query strings — deliver "present but empty". Where a value can be empty, the
    emptiness has to be tested, not assumed away.

71. **The clean-room gate exempts publishers of actions this project uses.** Merging the
    Dependabot pull requests put fifteen `repo-reference` violations into `main`: Dependabot
    quotes upstream release notes as full links, so its commit messages name
    `actions/setup-node` and friends with a host attached, which is exactly what rule 2
    matches. A `uses:` line never tripped it, because that has no host — so the same
    dependency was fine in five committed workflow files and a violation in the commit
    message that bumped it.

    Rule 2 exists so nothing ties this repository to _the operator's_ other repositories and
    sites. An action publisher is a toolchain dependency, in the same category as
    `github.com` already being an allowed domain, so the exemption is narrow and explicit:
    the owners whose actions appear in `.github/workflows/`, listed in the one file that is
    allowed to widen anything, and nowhere else. Proven in both directions — the four
    publishers pass, and an owner that merely _looks_ like one still fails.

    Recorded because scoping the history scan to `HEAD` (decision 54) solved this for bot
    _branches_ and this is the same problem arriving after a merge. The lesson is the same
    one: a gate has to survive the tools the project actually uses, or it gets switched off.

## v1.0.3 — what "no price" and "zero" are allowed to mean

72. **A model with no rate anywhere is refused, not priced at the job ceiling.** The old
    behaviour returned `fallbackUsd` — `max_cost`, the ceiling the _dispatcher_ set for one
    run — and carried on, printing "model has no known rate" as it went. That reads as
    conservative and is not. The ceiling is not what the model costs; it is a number this
    code invented. A monthly spend cap enforced against invented numbers is not measuring
    spend, and a ledger accumulating them is fiction shaped like accounting. DECISIONS 13
    and 33 chose the ceiling deliberately, so this reverses an earlier decision rather than
    fixing an oversight.

    `checkDispatch` now refuses before the caps are consulted, names the model, and says
    exactly what to add — `agents.modelRates` for that site. `estimateCost` stays pure and
    still reports `rateKnown: false`; the policy lives in the gate, beside the caps it
    protects. The escape hatch is the override that already exists, so a person can still
    say "go anyway" and have the reason record that nothing was checked against the cap.

    The cost of this is real and worth stating: the product ships rates for Anthropic models
    only, so enabling OpenAI, Gemini or a self-hosted endpoint now requires pricing it
    first. That is the right trade. Knowing what a provider costs before turning it on is
    not a burden; it is the thing the cap was for.

73. **A per-site cap of `0` means "may not spend", and a site with no cap says so by absence.**
    Found while auditing for the shape in decision 69, and it is the same bug wearing
    different clothes. `monthlyCapUsd` was `z.number().nonnegative().default(0)`, so after
    parsing there was no way to distinguish "this site declares no cap of its own" from
    "this site may spend nothing". `capsFrom` then tested `> 0` and dropped the site from the
    cap table entirely — making a deliberate `0` mean _unlimited_, governed only by the
    global cap.

    Meanwhile the identical `0` on `globalMonthlyCapUsd` blocks everything, because
    `checkDispatch` compares against it directly. One value, two contradictory meanings,
    inside one configuration object, and the dangerous reading was the one attached to the
    per-site field an operator is most likely to set to zero on purpose.

    `monthlyCapUsd` is now `.optional()`: absent means the global cap governs, a present `0`
    means this site may not spend, and `capsFrom` tests presence rather than truthiness. The
    global default stays `0` meaning "nothing runs until a budget is set deliberately" —
    that is the safe direction for a default and is unchanged. Three tests cover it,
    including the dispatch actually being refused for a zero-capped site.

    The general lesson, for the third time in three decisions: **a schema default that
    coincides with a meaningful value destroys information.** `{}` for rates, `0` for a cap.
    Where a field has a legitimate empty or zero value, it must be optional, so that
    "unset" and "set to nothing" stay different facts.

## v1.0.4 — the admin could never load a registry

74. **Every admin view was gated on a registry the browser had no way to obtain.** Reported
    as "the tabs do nothing". They were not broken: the island hydrated, there were zero
    console errors, zero failed requests, and both bundles resolved under the sub-path. The
    body was written `{registry && view === '…' && …}` six times over, so with no registry
    _nothing_ rendered — clicking a tab changed the view state and the screen stayed
    identical. Diagnosed before touching anything, because "inert" and "broken" have
    different fixes and the evidence said inert.

    The gate covered Settings too, which is what made it unrecoverable rather than merely
    empty: Settings is the one screen that matters when you have no sites, and after this
    release it is where the registry location is entered. The chicken could not reach the
    egg. Settings and Disconnect now render regardless, and every other view shows an empty
    state that says where to go instead of nothing at all.

75. **The registry had no browser-reachable location at all, which is the real defect.**
    `docs/site-registry.md` offered three: an Actions secret and two repository variables.
    All three are environment values. A runner has an environment; a static page on GitHub
    Pages does not. So the scheduler could always read the registry and the admin never
    could — the UI was not misconfigured, it was unreachable by construction.

    The admin now stores a **location** — owner, repository, path, ref — in `localStorage`
    and fetches the registry over the API with the operator's own token, on every load. The
    location is stored; the registry contents and the token are not. A token that survived a
    reload would outlive the session it was scoped to.

    A private companion repository is the only option offered in the browser, and the
    documentation now says why rather than implying parity: this screen asks for a
    fine-grained token, and a fine-grained token **cannot be granted gist access at all** —
    that permission exists only on classic tokens. A gist stays perfectly good for the
    runner, which holds its own credential.

    `PUBLIC_SITE_REGISTRY` is not the fix and is documented as private-deployment-only. A
    `PUBLIC_` value is inlined into the JavaScript bundle, and that bundle is served from a
    public origin: it would publish the operator's repository names, branches and deploy
    targets to anyone who opened devtools. A registry is a map of someone's infrastructure.

76. **The e2e build inlined the example registry, which is why nothing caught this.** Every
    admin test got its sites from a build-time injection, so the zero-registry state was
    unreachable in the suite even by accident — the one state every operator sees first was
    the one state no test could enter. The injection is gone. Tests that want sites now ask
    for them the way a browser does: a location in `localStorage` and a mocked API response,
    which also means the new path is covered end to end rather than only unit-tested.

    Two consequences worth recording. The registry now arrives asynchronously, so tests that
    click straight into content or the review queue race it — `waitForRegistry` waits for
    the dashboard's site count, the first thing that proves the registry parsed. And
    memoising `translator` stopped being cosmetic: `t` was recreated every render and is a
    dependency of the fetch effect, so the registry refetched on every render, replaced the
    registry object each time, handed every child a new `site` prop, and reset the editor
    mid-edit. The symptom was a save that never reported "Saved", three renders from the
    cause.
