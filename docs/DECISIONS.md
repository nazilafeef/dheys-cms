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
