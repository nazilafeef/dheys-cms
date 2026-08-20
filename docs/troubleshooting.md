# Troubleshooting

## The site builds but every link 404s once deployed

The base path. A GitHub Pages _project_ site serves from `/dheys-cms/`; almost everything
else serves from `/`. A URL built without the base looks perfect on localhost and 404s live.

```bash
pnpm build && pnpm check:links
```

That resolves every internal reference against the files actually built and names the ones
that would break. Every URL must go through `withBase` — string-concatenating onto
`import.meta.env.BASE_URL` produces `/dheys-cmsfavicon.svg`, because the base has no trailing
slash.

## check:links reports a fragment that does not exist

Usually a Dhivehi or Arabic heading. Thaana _fili_ and Arabic _harakat_ are Unicode marks,
not letters, so a pattern written `[\p{L}\p{N}]` deletes every vowel and the anchor stops
matching the heading. Include `\p{M}`.

## Content does not appear

In order of likelihood:

1. **`draft: true`.**
2. **`publishedDate` is in the future** — that is scheduling working.
3. **`state: rejected`.**
4. **It does not validate** — the build fails with the file and the field, so check the build
   output rather than the page.

## Two pages fight over one URL

Collection ids come from the filename unless `generateId` says otherwise, so
`posts/en/about.md` and `posts/dv/about.md` both become `about` and the second wins. Use the
`localeAwareId` generator in `src/content.config.ts`.

The same shape in reverse: two authors whose names transliterate to the same slug. Two Arabic
bylines both becoming `untitled` is a real bug this project shipped and fixed.

## The admin says the token was rejected

- It is a **classic** token, not fine-grained, and the repository is not in its scope.
- The fine-grained token does not list this repository.
- **Contents** is read-only; you need read _and write_.
- It expired.

A 404 on a private repository almost always means the token cannot see it, not that it is
missing. The error message says so.

## The admin says "reload and reapply"

Someone else committed to that file since you opened it. That is the conflict check working —
without it, your save would silently overwrite their edit. Reload and redo the change.

## The scheduler publishes nothing

1. **The kill switch.** `DHEYS_PUBLISHING_HALTED` is a repository variable; `true` halts
   everything. It also **fails closed** — if it cannot be read, the tick assumes it is on.
2. **`human-required` with no human approval.** The default policy.
3. **Guardrails.** Run `pnpm scheduler:tick --dry-run`; it prints the reason per item.
4. **Nothing is due.** Also visible in the dry run.

## The scheduler ran late

Expected. GitHub delays scheduled workflows under load and occasionally drops one. A missed
window publishes **late**, flagged as a catch-up, rather than being skipped.

## An agent job was rejected at intake

```
Job run-... rejected at intake: missing category, publishedDate.
```

That is the contract working. Models reliably omit taxonomy and dates; the alternative is a
site build failing three hours later, or an article dated the epoch. Put the site's
categories in `allowedCategories` so the model has a list to choose from.

## Cost dispatch is blocked

The monthly cap. Raise it in the registry, or re-run with an explicit override, which is
recorded. An **unpriced** model estimates at the job's `maxCostUsd` ceiling — deliberately
expensive rather than invisible — so set `agents.modelRates` for models this CMS does not
ship rates for.

## check:clean-room fails

It found a real hostname, a foreign repository reference, or something shaped like a
credential — in a file _or_ in a commit message, and it scans untracked files too.

Fix the source. Widen `ALLOWED_DOMAINS` only if the host genuinely belongs to the product
(a standards body, a provider endpoint the code calls). Demo content uses `example.com` and
friends.

## Lighthouse fails on the home page only

Almost certainly total blocking time on a cold browser. The gate takes one discarded warm-up
run for exactly this reason; if you invoke Lighthouse directly, do the same.

## E2E tests fail everywhere at once

That is a setup problem, not forty bugs.

- **Stale build.** `pnpm test:e2e` rebuilds first; `playwright test` on its own does not.
  (`pnpm` does not run `pre`/`post` script hooks.)
- **Base path.** `new URL('/x', 'http://host/dheys-cms')` discards the prefix. Tests go
  through the `at()` helper.
- **Hydration.** Clicking before the island hydrates submits the form for real. Tests wait
  for it.

## pnpm install warns about build scripts

`pnpm.onlyBuiltDependencies` in `package.json` should list `esbuild` and `sharp`.

## Still stuck

Open an issue with `pnpm gate` output, your Node and pnpm versions, and your OS. If it is
security-related, use a [security advisory](https://github.com/nazilafeef/dheys-cms/security/advisories/new)
instead.
