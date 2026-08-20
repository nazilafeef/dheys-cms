# Decisions

One line per judgement call the brief did not settle, in the order they were made. The
point of this file is that a later reader can tell what was chosen deliberately from what
merely happened.

## Slice 1 — skeleton, config, base path, CI, clean-room gate

1. **`gh` was not installed on the build machine.** The brief's preflight stops only for an
   *unauthenticated* `gh`. Absent is a different thing and installing a dependency is
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
   `www.`-prefixed hosts everywhere, and bare hosts in prose files and JSON *values* only.
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
