# Connecting a site

One command. It clones, analyses, migrates, removes the old CMS, rebuilds, and refuses the
whole thing if a single URL would stop resolving.

```bash
pnpm connect --repo example-org/example-news
```

For Claude Code, [CONNECT-PROMPT.md](./CONNECT-PROMPT.md) is a prompt that runs this and
reports back.

## Try it first

```bash
pnpm connect --from ../some-checkout --dry-run
```

Analyses and prints the inferred schema. Changes nothing.

## What happens

**1. Clone** into a temporary directory it creates and removes. `--keep-clone` leaves it for
inspection.

**2. Analyse** — framework, build command, output directory, package manager, host, content
locations, existing CMS, locales, sitemap. Where it cannot tell, it says so rather than
guessing: a wrong framework guess produces a build that fails loudly, but a wrong _content_
guess silently migrates half a site.

Recognised: Astro, Next, Nuxt, SvelteKit, Gatsby, Eleventy, Hugo, Jekyll, Vite SPA.
CMSes: Decap/Netlify CMS, Tina, Sanity, Contentful, Strapi, Keystatic.

**3. Record the URLs the site serves today** by running the target's own build. If that build
fails, the migration stops there — a route diff against a failed build compares nothing to
nothing and passes.

**4. Migrate the content**, including content no CMS manages. An array of post objects in a
`.ts` or `.js` data module is the usual shape, and it is the content most likely to be missed
precisely because nothing currently knows it exists. Those modules are **parsed, never
executed**: running arbitrary code out of somebody else's repository to read their blog posts
is not a trade worth making. Anything that will not parse is reported for a person rather
than guessed at.

**5. Infer the content model** from what the content actually contains. A field on every item
becomes required; a field on some becomes optional, because a schema that rejects the site's
own content is worse than one that is slightly loose.

**6. Wire the adapters** matching the framework and the detected host.

**7. Remove the previous CMS** — admin routes, config, dependencies, auth functions. A
half-removed CMS leaves dead endpoints and orphaned CSP entries that look fine until
something else breaks months later.

**8. Rebuild and diff the routes.**

**9. Refuse if a URL was lost.** Exit code 1. Nothing pushed.

**10. Write `MIGRATION-REPORT.md`** into the target.

## The one rule

**A migration may not lose a URL.**

Everything else is recoverable from git. A dropped URL is a dead link in somebody else's
article, a 404 in a search index, and it is usually noticed weeks later by someone who cannot
say what changed.

Redirects count as coverage — but only if the destination exists. A redirect to a 404 is a
404 with extra steps, and that is exactly what a careless check waves through.
`public/_redirects` and `vercel.json` are both read.

The comparison is coverage, not equality: new pages are expected and reported, never blocked.
Trailing slashes, `index.html`, casing and percent-encoding are normalised, so a framework
that changed `/about/index.html` to `/about.html` does not read as catastrophe.

## If it refuses

```
Route diff: FAILED — 1 URL(s) would stop resolving.

Lost:
  /articles/reading-the-monsoon

A migration may not lose a URL. Add a redirect, restore the route, or stop.
```

In order of preference: **add a redirect** and re-run; **restore the route**, usually a page
the old CMS was generating; or **stop**, and decide whether losing it is acceptable. It
rarely is.

## Afterwards

1. Read `MIGRATION-REPORT.md`.
2. Review `src/lib/dheys-schema.ts` — inference is a starting point, not an authority.
3. Add the site to your [registry](./site-registry.md).
4. Commit the target repository.

## Related

- [CONNECT-PROMPT.md](./CONNECT-PROMPT.md) · [site-registry.md](./site-registry.md) ·
  [wordpress-import.md](./wordpress-import.md)
