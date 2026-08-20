# The connect prompt

Paste this into Claude Code, with the target repository filled in. It is the whole
onboarding: one prompt, no manual steps.

---

## The prompt

```
Connect the website at <OWNER/REPO> to Dheys CMS.

Work in the Dheys CMS checkout. Do not modify any other repository on this machine.

Run:

    pnpm connect --repo <OWNER/REPO>

That command does the whole migration on its own — it clones the target into a temporary
directory, analyses it, records every URL the site currently serves, migrates the content,
infers a schema, removes the previous CMS, rebuilds, and refuses the migration if a single
URL would stop resolving.

When it finishes:

1. Read MIGRATION-REPORT.md in the migrated checkout and summarise it for me: what moved,
   what the inferred content model looks like, what was removed, and the route diff.

2. If the route diff FAILED, do not push anything. Tell me exactly which URLs would be
   lost and what the options are — a redirect, restoring the route, or stopping.

3. If it passed, add the site to my registry. Use the shape in docs/site-registry.md and
   the values the report gives you: repository, branch, content directory, locales, and
   the deploy adapter matching the host it detected. Tell me which registry storage I am
   using and show me the entry before you write it.

4. Tell me plainly what still needs a person — anything the analysis was uncertain about,
   any content it could not parse without executing code, and any guardrail the migrated
   content would currently fail.

Do not ask me questions before running the command. Run it, then report.
```

---

## What it will do

1. **Clone** the target into a temporary directory it creates and removes.
2. **Analyse** framework, build command, output directory, package manager, host, content
   locations, existing CMS, routing, locales and sitemap.
3. **Record the URLs the site serves today**, by running the target's own build.
4. **Migrate every piece of content** into CMS format — including content no CMS is
   currently managing, such as an array of posts in a data module.
5. **Infer the content model** from what the content actually contains, and emit a Zod
   schema. A field on every item is required; a field on some is optional.
6. **Wire the adapters** matching the framework and the host.
7. **Remove the previous CMS** — routes, config, dependencies, auth functions.
8. **Rebuild and diff the routes.**
9. **Refuse the migration if a URL was lost.** Exit code 1, nothing pushed.
10. **Write `MIGRATION-REPORT.md`** into the target.

## The one rule

A migration may not lose a URL.

Everything else the connector does is recoverable from git. A dropped URL is not: it is a
dead link in somebody else's article, a 404 in a search index, and it is usually noticed
weeks later by someone who cannot say what changed.

So the diff is not advisory. A lost URL exits non-zero and leaves the target untouched on
disk. A redirect counts as coverage — but only if its destination actually exists, because
a redirect to a 404 is a 404 with extra steps.

## Trying it first

```bash
pnpm connect --from ../some-local-checkout --dry-run
```

Analyses and prints the inferred schema. Changes nothing.

## If it refuses

That is the tool working. The report names every URL that would stop resolving. You have
three options, in order of preference:

1. **Add a redirect** in the target's own configuration (`public/_redirects`, or
   `vercel.json`), then re-run. The connector reads both and counts them.
2. **Restore the route** — usually the migration moved a page the old CMS was generating.
3. **Stop**, and decide whether losing that URL is acceptable. It rarely is.

## Related

- [connecting-a-site.md](./connecting-a-site.md) — the longer walkthrough
- [site-registry.md](./site-registry.md) — where the new entry goes
- [wordpress-import.md](./wordpress-import.md) — for a WordPress export rather than a repo
