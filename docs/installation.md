# Installation

## Requirements

- **Node 20.11+** — 22 recommended, and pinned in `.nvmrc`
- **pnpm 9+**
- **Git**
- For the ship sequence: the **GitHub CLI**, authenticated

## Local

```bash
git clone https://github.com/nazilafeef/dheys-cms.git
cd dheys-cms
pnpm install
pnpm dev
```

Open `http://localhost:4321/dheys-cms/`. The demo content is there immediately, in three
languages.

That is the whole local setup. No database, no services, no `.env` required to render the
site.

## Verifying the install

```bash
pnpm gate
```

Runs typecheck, lint, unit tests, the clean-room gate, the build and the link check. It
should pass on a clean clone. If it does not, that is a bug worth reporting.

For the browser suites:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
pnpm lighthouse
```

## Deploying

The control plane deploys to GitHub Pages from `.github/workflows/deploy.yml` on every push
to `main`.

1. **Settings → Pages → Source: GitHub Actions.**
2. Push.

The workflow reads its origin and base path from `actions/configure-pages`, so the bundle is
built for exactly where it will be served rather than for a value hard-coded in the config.

### Hosting somewhere else

```bash
SITE_URL=https://cms.example.test BASE_PATH=/ pnpm build
```

Both hosting modes are first-class and both are verified in CI — a project sub-path
(`/dheys-cms/`) and a root deployment. Serving from `dist/` is all that is required; there
is nothing to run.

## Next

1. [Set up a registry](./site-registry.md) — it never lives in this repository.
2. Create a GitHub fine-grained PAT scoped to the repositories you manage.
3. Open `/admin` and paste it. It is held for that browser tab only.
4. [Connect a site](./connecting-a-site.md).
