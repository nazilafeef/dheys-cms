# State

Rewritten at the end of every slice. A resumed session reads
[BUILD-BRIEF.md](./BUILD-BRIEF.md) and this file, then continues from **Next action**.

## Current slice

**None. The build and the ship sequence are both complete.** Slices 1–18, the operator's three
amendments, ship steps 0–7 against the real remote, and a follow-up instruction that resolved
every open dependency advisory. v1.0.1 is published.

## Next action

Nothing outstanding can be done from here. What remains needs the operator's own hands and is
listed in `release/OWNER-TODO.md`; two items are new since the ship:

- **OWNER-TODO 8 — delete the scratch repository** left by ship step 6. It is private, named
  `dheys-cms-ship-check-` followed by a timestamp, and holds seven invented files. The supplied
  token could not delete it: that needs the `delete_repo` scope, which `repo` does not imply.
  `gh auth refresh -h github.com -s delete_repo`, then `gh repo delete <name> --yes`.
- **OWNER-TODO 9 — decide on five open Dependabot PRs.** They bump GitHub Actions versions, not
  dependencies. Merging them clears the "Node.js 20 is deprecated" annotation every run
  carries. They are not security alerts; those are all closed.

## Live

| What          | Where                                               | State                       |
| ------------- | --------------------------------------------------- | --------------------------- |
| Control plane | `https://nazilafeef.github.io/dheys-cms/`           | live, 200                   |
| Repository    | `https://github.com/nazilafeef/dheys-cms`           | public, description, topics |
| Release       | `v1.0.1`, zip and bundle attached                   | published                   |
| Pages         | source set to GitHub Actions                        | enabled                     |
| Variables     | `DHEYS_PUBLISHING_HALTED=false`, `COST_LEDGER_PATH` | set                         |
| Secrets       | **none, permanently**                               | by decision 49              |
| Dependabot    | alerts and security updates on                      | **0 open alerts**, 19 fixed |

## Ship sequence

| Step            | State                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| 0 — preflight   | done. `gh` authenticated as `nazilafeef`, scopes `repo, workflow`; remote empty. |
| 1 — hygiene     | done. Clean-room gate over the full tree and every commit message.               |
| 2 — push        | done. Description, homepage and eight topics set.                                |
| 3 — configure   | done, **minus Actions secrets by instruction**. Pages, variables, Dependabot.    |
| 4 — deploy      | done. First run failed on ordering; see decision 53. Re-dispatched green.        |
| 5 — verify live | done. **37 checks, 37 passed**, plus Lighthouse against the live origin.         |
| 6 — automation  | done, **minus the final delete**. 16 of 17; the token lacks `delete_repo`.       |
| 7 — package     | done. Bundle-verified, attached to the `v1.0.1` release.                         |

## Gate status

Every row was run against a **clone of the release bundle**, not this tree, and observed. Raw
logs in `release/REPORT.md`, Appendices A–D. Reproduce with `pnpm verify:release`,
`pnpm verify:automation` and `pnpm verify:live`.

| Gate                             | Status                | Notes                                                     |
| -------------------------------- | --------------------- | --------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | pass                  | no warnings                                               |
| `pnpm typecheck`                 | pass                  | `astro check`, 96 files: 0 errors, 0 warnings, 0 hints    |
| `pnpm lint`                      | pass                  | ESLint 9 flat config plus a Prettier format check         |
| `pnpm test`                      | pass — 660 tests      | 20 files, 0 skipped, 0 todo                               |
| `pnpm test:e2e`                  | pass — 44 tests       | real build, mocked GitHub, no network                     |
| `pnpm check:clean-room`          | pass                  | 190 files plus every commit message reachable from `HEAD` |
| `pnpm build`                     | pass                  | warning-free; the Pagefind `dv` stemmer note is a note    |
| `pnpm check:links`               | pass — 651 references | both hosting modes                                        |
| `pnpm lighthouse`                | pass                  | 100/100/100/100 on five pages, locally and **live**       |
| `pnpm verify:live`               | pass — 37 checks      | against `https://nazilafeef.github.io/dheys-cms/`         |
| CI on the remote                 | pass                  | Node 22 and 24 on ubuntu, plus a root-hosting build       |

Article-page JS is 2,878 bytes (en) and 2,971 (dv), all inline, against a 30 KB budget.

## Dependencies

`pnpm audit` reports zero vulnerabilities; the repository has zero open Dependabot alerts.
Astro was taken from 5.18.2 to **7.2.4** — two majors — to clear eight advisories, with
`esbuild` and `sharp` following. See decisions 55–58 and `CHANGELOG.md` 1.0.1.

## Open decisions affecting what comes next

- **DECISIONS.md #5** — bare hostnames are not scanned inside source files. If site
  configuration ever moves into a `.ts` file, that file must join the prose set or the
  configuration must stay in YAML/JSON.
- **DECISIONS.md #13 and #33** — only Anthropic model rates ship. Any other provider prices at
  the job ceiling until an operator sets a rate override on the site.
- **DECISIONS.md #29** — the Anthropic JSON Schema is maintained beside the Zod schema. A test
  asserts they agree on the required-field set; a field added to one must be added to the other.
- **DECISIONS.md #51** — the Node floor is 22.19 and CI runs 22 and 24. Node 20 cannot install
  this dependency graph at all, whatever the manifest claims.
- **DECISIONS.md #54** — the clean-room history scan reads `HEAD`, not `--all`, so a bot branch
  cannot change its verdict. Anything that probes the gate's history must move `HEAD`.
- **DECISIONS.md #57** — Astro 7 daemonises `astro preview`. Anything that shells out to a
  long-lived process should go through `scripts/preview-control.mjs` rather than assume a
  foreground child.

## Blocked

Nothing, on this side.

## Half-finished

Nothing.
