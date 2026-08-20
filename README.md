# Dheys CMS

One editorial desk for every site you run.

Dheys CMS manages content for many websites from one deployment, on any host. It handles
articles written by people and by AI agents in a single editorial pipeline, with
configurable approval gates and automated scheduling — and the control plane runs on GitHub
Pages with no server, no database, and nothing to pay for.

**MIT licensed. No telemetry. No required backend. No paid service in the default path.**

---

## How it works

A static site cannot run a scheduler, hold an API key, or orchestrate agents. So it does not
try. There are three layers:

| Layer             | Runs on                              | Owns                                                                                                                  |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Control plane** | Static Astro build on GitHub Pages   | Admin, editor, review queue, calendar. Talks only to `api.github.com`. Holds no secret beyond a session-scoped token. |
| **Automation**    | GitHub Actions                       | Scheduler, agent runner, deploy dispatch. Every AI key lives here, readable only inside a runner.                     |
| **Content**       | Your own site repositories, any host | Markdown + frontmatter, committed by the automation layer or by the admin. Each site keeps its own build and deploy.  |

The admin never calls an AI provider. It dispatches a workflow and polls the run through the
GitHub API. That is what keeps every key on the far side of a boundary a browser cannot
cross.

---

## Five-minute quickstart

```bash
git clone https://github.com/nazilafeef/dheys-cms.git
cd dheys-cms
pnpm install
pnpm dev
```

That is the whole setup. The demo content — three locales, two of them right-to-left —
renders immediately at `http://localhost:4321/dheys-cms/`.

To manage real sites you need two more things:

1. **A registry.** It never lives in this repository. Copy `src/sites.example.json` into a
   private gist, a private companion repository, or a repository secret, replace every
   value, and point the deployment at it. See [docs/site-registry.md](./docs/site-registry.md).
2. **A token.** A GitHub fine-grained PAT scoped to the repositories you want to manage.
   Paste it into `/admin`. It is held in `sessionStorage` for that browser tab only.

Deploying is one push: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages,
reading its base path from `actions/configure-pages` rather than assuming one.

---

## What it does

**Multi-site.** One dashboard and one review queue across every connected site. Per-site
permissions, per-site guardrails, per-site cost caps. Sites can be on GitHub Pages,
Cloudflare Pages, Netlify, Vercel, or anything reachable by webhook.

**Editorial pipeline.** `idea → commissioned → researching → drafting → draft → in-review →
approved → scheduled → published`, with `changes-requested` and `rejected` branches. Every
transition records who did it and when, in frontmatter. The git history _is_ the audit
trail — recoverable from a clone, with no database to query.

**Human and AI writers in one queue.** Agent output arrives through a strict
[job contract](./docs/agent-job-contract.md) and lands in review, never live. Every
AI-authored item carries provenance — model, prompt version, sources, tokens, cost, run id —
and renders an attribution line. AI content is never published under a bare human byline,
and that is enforced in the schema rather than the interface.

**Scheduling that survives reality.** Cron runners are late and occasionally skipped, so
every tick is idempotent, a missed window publishes _late_ rather than silently vanishing,
and randomised publish times are seeded per item so the calendar, the tick and the test all
agree. One repository variable halts publishing across every site without a redeploy.

**Guardrails that block, not warn.** Required fields, banned phrases, minimum word count,
required disclosure, human review, locale completeness, Thaana punctuation. One ships on by
default: an item carrying an affiliate offer cannot publish without a disclosure — enforced
in the schema, so it binds agent output and direct commits too.

**Right-to-left as a first-class citizen.** Dhivehi (Thaana) and Arabic ship alongside
English. Logical CSS properties throughout, correct `dir` and `lang`, Thaana-safe slug
transliteration, Thaana punctuation enforced in content, an RTL-correct admin, and every UI
string in locale JSON.

**A front end that stays out of the way.** Under 30 KB of JavaScript on an article page —
currently zero bytes of framework code. Share links are plain anchors with no third-party
script. An unfilled ad slot makes no network request at all. Dark and light with no flash.

**The one-prompt connector.** Point it at an existing site and it migrates the whole thing:
analyses the framework, migrates content _including content no CMS is managing_, infers a
schema, removes the previous CMS, and refuses the migration outright if a single URL would
stop resolving. See [docs/connecting-a-site.md](./docs/connecting-a-site.md).

---

## Quality gates

Every one of these runs in CI on Node 20 and 22, and each must pass on a clean clone.

```bash
pnpm install --frozen-lockfile   # no warnings, no peer conflicts
pnpm typecheck                   # astro check + tsc --noEmit
pnpm lint                        # eslint + prettier
pnpm test                        # vitest
pnpm test:e2e                    # playwright; GitHub and every AI provider mocked
pnpm check:clean-room            # no leaked domain, repo reference or credential
pnpm build                       # zero errors, zero warnings
pnpm check:links                 # every internal link resolves, in both hosting modes
pnpm lighthouse                  # all four categories >= 95
```

No test may reach a real AI provider or the real GitHub API, and that is a property of the
design rather than a promise: every provider and every client is handed its transport.

---

## Screenshots

Not included. The demo site is the screenshot — run `pnpm dev` and it is in front of you in
about ten seconds, in three languages, which is more useful than a PNG that goes stale.

---

## Documentation

**Getting started** — [installation](./docs/installation.md) ·
[configuration](./docs/configuration.md) · [site registry](./docs/site-registry.md) ·
[connecting a site](./docs/connecting-a-site.md)

**Using it** — [content authoring](./docs/content-authoring.md) ·
[admin](./docs/admin.md) · [automation and scheduling](./docs/automation.md) ·
[guardrails](./docs/guardrails.md)

**Extending it** — [theming](./docs/theming.md) ·
[custom content types](./docs/custom-content-types.md) ·
[agent job contract](./docs/agent-job-contract.md) ·
[writing a provider](./docs/writing-a-provider.md)

**Reference** — [i18n and RTL](./docs/i18n-and-rtl.md) ·
[fonts and licensing](./docs/FONTS.md) · [security](./docs/SECURITY.md) ·
[WordPress import](./docs/wordpress-import.md) ·
[troubleshooting](./docs/troubleshooting.md)

**About the build** — [plan](./docs/PLAN.md) · [decisions](./docs/DECISIONS.md) ·
[state](./docs/STATE.md) · [theme provenance](./docs/THEME-PROVENANCE.md)

---

## Known limitations

Stated here rather than discovered later:

- **No font binary ships**, and none should be added without resolving the licensing
  position in [docs/FONTS.md](./docs/FONTS.md). Dhivehi renders in whatever Thaana face the
  reader's system provides, which on many systems is none.
- **The token lives in `sessionStorage`.** Any script running on the origin can read it.
  There is no way around that in a browser without a server; the trade-offs are stated
  honestly in [docs/SECURITY.md](./docs/SECURITY.md), along with the GitHub App path for
  operators who want the credential out of the browser entirely.
- **Only Anthropic model rates ship.** Rates for other providers are deliberately absent
  rather than guessed; an unpriced model is treated as costing its job ceiling, so it is
  expensive rather than invisible. Set your own in the registry.
- **Pagefind does not stem Dhivehi.** Search works and matches whole words; it will not
  match across root forms.
- **The Dhivehi and Arabic UI strings have not been reviewed by a native speaker.** They are
  complete and structurally correct — right script, right direction, right punctuation — but
  the wording deserves a pass.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The short version: run `pnpm gate` before opening a
pull request, and do not add a dependency without saying what it replaces.

## Licence

MIT — see [LICENSE](./LICENSE).
