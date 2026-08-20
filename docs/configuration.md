# Configuration

Everything is environment variables and the registry. There is no config file to learn.

## Build

| Variable               | Default                        | What it does                                                                          |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `SITE_URL`             | `https://nazilafeef.github.io` | Origin, for canonical URLs, feeds and the sitemap.                                    |
| `BASE_PATH`            | `/dheys-cms`                   | Deployment sub-path. Use `/` for root hosting.                                        |
| `PUBLIC_THEME`         | `bare`                         | `bare` or `dheys`.                                                                    |
| `PUBLIC_SITE_REGISTRY` | —                              | Registry JSON injected at build time, so the admin has sites without a runtime fetch. |

`BASE_PATH` is the one to get right. A project page serves from `/dheys-cms/` and everything
else from `/`; code that assumes either ships broken on the other. Both are tested, and
`pnpm check:links` verifies the built output in both modes.

## Registry

Exactly one of these. See [site-registry.md](./site-registry.md).

| Variable                 | Kind                                      |
| ------------------------ | ----------------------------------------- |
| `SITE_REGISTRY_JSON`     | secret — the JSON itself                  |
| `SITE_REGISTRY_GIST`     | variable — a private gist id              |
| `SITE_REGISTRY_REPO`     | variable — `owner/name[:path][@ref]`      |
| `SITE_REGISTRY_FILENAME` | variable — defaults to `dheys-sites.json` |

## Runners

| Variable                  | Kind     | For                                                             |
| ------------------------- | -------- | --------------------------------------------------------------- |
| `DHEYS_SITE_TOKEN`        | secret   | Writing to connected site repositories. Not the workflow token. |
| `DHEYS_PUBLISHING_HALTED` | variable | The kill switch. `true` halts all publishing.                   |
| `COST_LEDGER_PATH`        | variable | Defaults to `.dheys/cost-ledger.json`.                          |

## Providers

All opt-in. An unset key means that provider is unavailable, and the runner says so by name
rather than falling back to a different model.

| Variable                                                                             | Provider                        |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                                               | Anthropic                       |
| `OPENAI_API_KEY`, `OPENAI_MODEL`                                                     | OpenAI                          |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                                     | Google Gemini                   |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL` | Any OpenAI-compatible endpoint  |
| `EXTERNAL_AGENT_URL`, `EXTERNAL_AGENT_TOKEN`                                         | An external pipeline by webhook |

## Deploy confirmation

Optional. Without them a deploy adapter reports _delivery_ — that the hook was accepted —
rather than claiming the deploy succeeded.

| Variable                                        | For              |
| ----------------------------------------------- | ---------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Pages |
| `NETLIFY_AUTH_TOKEN`                            | Netlify          |
| `VERCEL_TOKEN`                                  | Vercel           |

## Where each belongs

**Actions secrets** — anything that grants access: tokens, API keys, deploy hooks, the
registry if stored inline.

**Actions variables** — anything that is merely configuration: the kill switch, a gist id, a
model name, a base URL.

**Never in this repository.** `.env.example` ships with empty values only, and
`pnpm check:clean-room` fails the build if a credential-shaped string appears anywhere in the
tree or the commit history.
