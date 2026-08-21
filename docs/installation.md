# Installation

## Requirements

- **Node 22.19+** — pinned in `.nvmrc`, and the floor `engines.node` enforces
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

## Run your own private instance

Before you deploy anything real, understand the split, because it decides where your keys
end up.

**The published repository holds nothing.** No AI keys, no `DHEYS_SITE_TOKEN`, no site
registry, no Actions secrets at all. Its secret store is deliberately empty. If you are
looking at the public copy and wondering where the configuration went, that is the answer:
there isn't any, by design.

**Your instance holds everything.** Fork the repository — keeping the fork private — or
clone it and push to a private repository of your own:

```bash
git clone https://github.com/nazilafeef/dheys-cms.git my-dheys
cd my-dheys
git remote set-url origin <your own private repository>
git push -u origin main
```

Then configure that repository, and only that one:

| What                                                                   | Where                                         | Notes                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`                | Actions **secret**                            | All opt-in. None is required; the CMS runs with zero providers.             |
| `DHEYS_SITE_TOKEN`                                                     | Actions **secret**                            | Lets the runner commit to your site repositories.                           |
| Site registry                                                          | Private gist, private repo, or Actions secret | Never a file in the repository. See [site-registry.md](./site-registry.md). |
| `DHEYS_PUBLISHING_HALTED`                                              | Actions **variable**                          | The kill switch. Set it to `false` to start.                                |
| `SITE_REGISTRY_GIST` / `SITE_REGISTRY_REPO` / `SITE_REGISTRY_FILENAME` | Actions **variable**                          | Where to find the registry.                                                 |

[configuration.md](./configuration.md) is the full table, including which of secret and
variable each item belongs in.

### Why the split exists

A secret set on a public repository is one careless `run:` line away from being printed into
a log that anybody can read, and a registry naming your sites, their repositories and their
deploy hooks is a map of your infrastructure. Neither belongs in a copy that strangers can
fetch. The cost of avoiding both is one fork.

Updates flow one way. Pull from the public repository whenever you want them; nothing you
add to your instance travels back.

### The guard on the public side

`pnpm check:clean-room` fails the build if a credential-shaped string, a foreign domain, or a
reference to any repository other than this one appears anywhere in the tree **or in any
commit message in the history**. It runs in CI on every push. That is what makes "the public
copy holds nothing" a property you can check rather than a promise you have to trust — and it
is also why you should not try to keep your registry here even temporarily. The build will
stop, which is the intended outcome.

---

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
