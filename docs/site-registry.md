# The site registry

The registry is the list of sites Dheys CMS manages, and everything it needs to know about
each one: which repository, which branch, which locales, which guardrails, which deploy
adapter, what it may spend.

**It never lives in this repository.** A registry names real repositories, real branches and
real deploy hooks — exactly the information a public, general-purpose repository must not
carry. This repository ships `src/sites.example.json`, whose three sites are invented, and
nothing else. `pnpm check:clean-room` fails the build if a real one appears.

## Where to put it

Four options, and **which one you pick depends on what has to read it.** Two things read the
registry, and they cannot reach the same places:

| Option                                   | Runner (scheduler, agent runs) | Browser (the admin) |
| ---------------------------------------- | ------------------------------ | ------------------- |
| Actions secret `SITE_REGISTRY_JSON`      | yes                            | **no**              |
| Repository variable `SITE_REGISTRY_GIST` | yes                            | **no**              |
| Repository variable `SITE_REGISTRY_REPO` | yes                            | **no**              |
| **Saved in the admin's Settings screen** | no                             | **yes**             |

The first three are environment values. A runner has an environment; a static page served
from GitHub Pages does not, so the admin cannot read any of them — it has no server to ask.
Set one of the first three for the automation, and set the fourth in the browser you
administer from. They can point at the same file, and usually should.

All of them load through the same code path and validate against the same schema, so
switching later is a configuration change and nothing more.

### 1. A repository secret — simplest _(runner only)_

Paste the JSON into an Actions secret named `SITE_REGISTRY_JSON`. The runners read it
directly from the environment.

```
Settings → Secrets and variables → Actions → New repository secret
Name:  SITE_REGISTRY_JSON
Value: { "version": 1, ... }
```

Good for a single operator. The whole registry is one secret, versioned only by GitHub's own
secret history, so a mistake is harder to recover from.

### 2. A private gist — easiest to edit _(runner only)_

Create a **secret** gist containing `dheys-sites.json`, then set a repository _variable_:

```
SITE_REGISTRY_GIST      = <the gist id>
SITE_REGISTRY_FILENAME  = dheys-sites.json     (optional; this is the default)
```

Gists keep revision history, so you can see what changed and roll back. Any token with the
`gist` scope can read it, which is worth remembering before putting anything sensitive in.

### 3. A private companion repository — best for teams _(runner only)_

Keep `dheys-sites.json` in a private repository. Set:

```
SITE_REGISTRY_REPO = owner/name
# or with an explicit path and ref:
SITE_REGISTRY_REPO = owner/name:config/dheys-sites.json@main
```

Changes go through pull requests and code review like anything else, which is what you want
once more than one person can change what publishes where.

**Precedence**, when more than one is set: `SITE_REGISTRY_JSON`, then `SITE_REGISTRY_GIST`,
then `SITE_REGISTRY_REPO`. Inline wins because it is the most explicit — an operator who
pasted a registry into a secret said exactly what they meant, and a stale gist id elsewhere
in the environment should not quietly override it.

### 4. Saved in the admin — the only one the browser can use

Open the admin, connect with your token, and go to **Settings**. Enter the repository that
holds `dheys-sites.json`:

```
Owner       nazilafeef
Repository  dheys-cms-instance
File path   dheys-sites.json      (default)
Branch      main                  (default)
```

The admin remembers the **location** in `localStorage` and fetches the registry over the
GitHub API with your own token, each time you load the page. It never stores the registry
contents, and it never stores the token — a token that survived a reload would outlive the
session it was scoped to.

This is per-browser. Administering from a second machine means entering it again there,
which is the trade for never putting a map of your infrastructure into a public bundle.

**A private repository, not a gist.** This screen asks for a fine-grained token, because
that is the kind you can scope to a single repository — and a fine-grained token cannot be
granted gist access at all. Gist permissions exist only on classic tokens. Option 2 remains
perfectly good for the _runner_, which holds its own credential; it simply cannot work in a
browser, so the admin does not offer it.

> **Not `PUBLIC_SITE_REGISTRY`.** An earlier build read a registry from a `PUBLIC_`-prefixed
> build variable. Anything so prefixed is inlined into the JavaScript bundle, and that bundle
> is served from a public origin — it would publish your repository names, branches and
> deploy targets to anyone who opened devtools. It is still honoured for a _private_
> deployment, where the bundle is not public, and it is never the right answer for the
> published site.

## Shape

```json
{
  "version": 1,
  "globalMonthlyCapUsd": 40,
  "defaultTimezone": "Indian/Maldives",
  "sites": [ ... ]
}
```

### A site

```json
{
  "id": "example-news",
  "name": "Example News",
  "repo": { "owner": "example-org", "name": "example-news", "branch": "main" },

  "contentDir": "src/content",
  "mediaDir": "public/media",

  "locales": ["dv", "en", "ar"],
  "defaultLocale": "dv",
  "theme": "dheys",
  "contentTypes": ["post", "page", "author", "category", "tag"],

  "publishing": {
    "defaultTimezone": "Indian/Maldives",
    "defaultApprovalPolicy": "human-required",
    "defaultWindow": {
      "from": "08:00",
      "to": "11:00",
      "timezone": "Indian/Maldives",
      "days": [0, 1, 2, 3, 4]
    }
  },

  "agents": {
    "enabled": true,
    "providers": ["anthropic"],
    "defaultModel": "claude-opus-5",
    "chains": { "news": ["research", "write", "fact-check", "seo-optimise"] },
    "monthlyCapUsd": 25,
    "modelRates": {}
  },

  "deploy": { "kind": "github-pages", "workflow": "deploy.yml", "ref": "main" },
  "content": { "kind": "collections", "directory": "src/content/posts", "extension": "md" },

  "guardrails": [
    { "type": "required-disclosure", "kind": "affiliate" },
    { "type": "human-review-required" },
    { "type": "minimum-words", "count": 250 }
  ],

  "permissions": {
    "example-editor": "owner",
    "example-reviewer": "reviewer"
  }
}
```

### Fields worth explaining

**`id`** addresses content and appears in commit messages and cost records. Lowercase,
digits and hyphens. Two sites may not share one.

**`defaultLocale`** must appear in `locales`. The loader refuses a registry where it does
not, because the alternative is a site whose home page has no content.

**`permissions`** maps a GitHub login to a role: `owner`, `editor`, `reviewer`,
`contributor`, `viewer`, in descending order of authority. A login that is absent has no
access to that site and does not see it in the admin at all.

**`agents.modelRates`** is required for any model this CMS does not ship rates for. Only
Anthropic rates are built in.

Since **v1.0.3 an unpriced model is refused, not estimated.** The dispatch check stops
before the caps are consulted, names the model, and tells you to add a rate here. Earlier
versions priced it at the job's own `maxCostUsd` ceiling and carried on, which sounds
conservative but is not: that ceiling is a number the code invents, and a monthly cap
enforced against invented numbers is not measuring spend. An explicit override still lets a
run through, and records that nothing was checked against the cap.

Rates a site sets here **override** the shipped table for those models and leave the rest
alone — an empty `{}` means "no overrides", not "no rates". Practically: enabling OpenAI,
Gemini or a self-hosted endpoint means pricing it first.

**`deploy`** names _environment variables_, never values. `SAMPLE_SHOP_CF_DEPLOY_HOOK` is
the name of an Actions secret; the hook URL itself lives there and is readable only inside
a runner.

**`guardrails`**, if omitted or empty, falls back to the shipped defaults — affiliate
disclosure, AI disclosure, Thaana punctuation. See [guardrails.md](./guardrails.md).

## Adapters

**Deploy**: `github-pages`, `cloudflare-pages`, `netlify`, `vercel`, `webhook`.
Each triggers a deploy and reports whether it _succeeded_ — the scheduler needs to know a
publish actually reached the live site, and a 200 from a deploy hook does not tell it that.
Where a host exposes no way to check, the adapter says so rather than claiming success.

**Content**: `collections` (Astro/Next, direct — no transform), `json` (a complete, valid
JSON array a consumer can `import ... with { type: 'json' }`), `js-module`, and `generic`
(Markdown plus a transform command you supply).

## Validating yours

```bash
pnpm test -- site-registry
```

The loader reports the field, not just that something is wrong:

```
Registry is not valid:
  sites.0.id: site id must be lowercase, digits and hyphens
  sites.1.deploy: Invalid discriminator value. Expected 'github-pages' | ...
```

## Related

- `src/sites.example.json` — a complete, valid registry with three invented sites
- [configuration.md](./configuration.md) — every environment variable
- [automation.md](./automation.md) — how the scheduler reads it
