# Changelog

Notable changes to Dheys CMS. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow [semantic versioning](https://semver.org).

## [1.0.0] — 2026-08-21

First release.

### The system

- **Three layers.** A static control plane on GitHub Pages, automation in GitHub Actions,
  and content in the user's own site repositories. No server, no database, nothing to pay
  for, and no AI key reachable from a browser.
- **Multi-site.** One dashboard and one review queue across every connected site, with
  per-site permissions, guardrails and cost caps.
- **Site registry** loadable from a private gist, a private companion repository, or a
  repository secret. It never lives in this repository.

### Editorial

- Full state machine — `idea` through `published`, with `changes-requested` and `rejected`
  branches. Every transition records an actor and a timestamp in frontmatter; the git
  history is the audit trail.
- Review queue with approve, request-changes and reject, and the guardrail verdict computed
  before anyone decides.
- Three approval policies: `human-required` (the default), `human-optional` with a deadline,
  and `auto`.
- Editor with a Markdown toolbar, sandboxed live preview, an SEO panel with counters and a
  social preview, slug collision detection, and an unsaved-changes guard.

### Agents

- Five providers behind one interface — Anthropic, OpenAI, Gemini, any OpenAI-compatible
  endpoint, and an external pipeline by webhook — plus bring-your-own. All opt-in.
- A strict [job contract](./docs/agent-job-contract.md), published as JSON Schema. Items
  missing `category` or `publishedDate` are rejected at intake by name.
- Provenance built from the dispatch record, never from the model's output. AI content is
  never published under a bare human byline; that is enforced in the schema.
- Cost caps enforced *before* dispatch, per site and globally, with an explicit override.

### Scheduling

- Cron scheduler with idempotent ticks, missed-window catch-up, seeded-deterministic
  randomised publish times, embargoes and drip scheduling.
- A repository-variable kill switch that halts publishing everywhere without a redeploy, and
  fails closed.
- Five deploy adapters, each distinguishing a *delivered* trigger from a *confirmed* build.

### Guardrails

- Required fields, banned phrases, minimum word count, required disclosure, human review,
  locale completeness and Thaana punctuation.
- Affiliate disclosure ships on by default and is enforced in the schema, so it binds agent
  output and direct commits too.

### Front end

- Home, article, archive, author, page, search and a real 404, across three locales.
- Under 30 KB of JavaScript on an article page — currently zero bytes of framework code.
- RSS, Atom, JSON Feed, sitemap with `hreflang` alternates, news sitemap, `robots.txt`,
  `llms.txt`, and JSON-LD.
- Pagefind search across all three languages.
- Two themes, both proven to clear WCAG AA contrast in light and dark by a test that parses
  the token files.

### Internationalisation

- English, Dhivehi (Thaana, RTL) and Arabic (RTL).
- Thaana and Arabic slug transliteration, Thaana punctuation enforcement, logical CSS
  properties throughout, and a documented Thaana font slot that ships no binary.

### The connector

- `pnpm connect` analyses, migrates, removes the previous CMS and verifies a target site in
  one command — refusing the migration outright if a single URL would stop resolving.

### Quality

- 650 unit tests, 44 end-to-end tests, all four Lighthouse categories at 100.
- A clean-room gate scanning every file and the whole commit history for leaked domains,
  foreign repository references and credentials.
- CI on Node 20 and 22, both hosting modes, with a nightly Windows and macOS matrix.

[1.0.0]: https://github.com/nazilafeef/dheys-cms/releases/tag/v1.0.0
