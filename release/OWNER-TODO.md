# Owner TODO

Things that need the operator's own hands or judgement. Each entry says what it blocks and
roughly how long it takes. Numbered so DECISIONS.md and the final report can cite them.

---

**1. Authenticate the GitHub CLI.** — *2 minutes, blocks the whole ship sequence*

`gh` is installed (2.97.0) but not logged in, and the login is a browser flow that cannot be
completed from a non-interactive session.

```
gh auth login -h github.com -s repo,workflow,admin:repo_hook -w
```

Blocks: pushing to the remote, creating the repository, enabling Pages, setting Actions
secrets and repository variables, triggering the deploy, verifying against the live URL,
the end-to-end automation test against a scratch repository, and cutting the release.
Everything else in the build is unaffected.

---

**2. Confirm the Dheys logo is the artwork you intended.** — *1 minute, cosmetic* — **mostly done**

`src/assets/brand/dheys-logo.svg` was placed there during the build (a 2.7 KB single-path
Thaana wordmark, `viewBox="0 0 309 160"`). It is wired into the Dheys theme and the build no
longer warns. No substitute was drawn at any point — the placeholder path remains in the
code for the case where the file is absent.

Worth checking: the artwork ships with `fill="#000"`, which the theme overrides to
`currentColor` so it inverts correctly in dark mode. If the intended mark has more than one
colour, it needs re-exporting.

Blocks: nothing.

---

**3. Have the Dhivehi and Arabic UI strings reviewed by a native speaker.** — *about an hour*

`src/locales/dv.json` and `src/locales/ar.json` are complete — every key present, correct
script, correct direction, Thaana punctuation used rather than Latin — but the wording was
written during the build and has not been checked by a native speaker. Some phrasing will
read as stiff or literal.

Blocks: nothing technical. Affects how the product reads to Dhivehi and Arabic users.

---

**4. Decide the Thaana font question.** — *depends entirely on the licence holder*

No font binary ships in this repository and none should be added without resolving the
licensing position described in `docs/FONTS.md`. The theme references a Thaana webfont by
config path under a documented metric contract; `pnpm link-font` points a local install at
files kept outside the repository.

Blocks: Dhivehi text renders in whatever Thaana face the reader's system provides, which on
many systems is none.

---

**5. Set the AI provider keys you intend to use — in your private instance, not here.** — _5 minutes per provider_

No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` was present in the build
environment, and none was read, requested or written at any point. Every provider is built
and tested against mock transports; none has been exercised against a live endpoint.

Add the ones you want as Actions secrets **on your own private instance** — see
[the split](../docs/installation.md#run-your-own-private-instance). Providers are opt-in and
the CMS runs fine with none of them configured.

Blocks: agent commissioning. Nothing else.

---

**6. Choose where the site registry lives.** — *10 minutes*

The registry never lives in this repository, and on a *public* copy that is not a
preference but a rule -- see entry 7. Pick one of the three documented options in
`docs/site-registry.md` -- a private gist, a private companion repository, or a repository
secret -- and point your private instance at it. Until then the admin has no sites to manage
and says so.

Blocks: connecting any real site.

---

**7. Nothing is missing from this repository's secret store — it is empty on purpose.** — _nothing to do_

If you open Settings → Secrets and variables → Actions on this repository and find no
secrets, that is the intended state, not an unfinished step. This repository is the
published product. It has never held an AI key, a `DHEYS_SITE_TOKEN`, or a site registry,
and it should not be given one.

The reasoning, in one line: a secret on a public repository is one careless workflow line
away from a log anybody can read, and a registry naming your sites and their deploy hooks is
a map of your infrastructure. Both belong in a private instance you control.

What that means in practice:

- **Deploying this repository to Pages needs no secrets at all.** The deploy workflow uses
  the built-in `GITHUB_TOKEN` and nothing else, so the public site builds and serves with an
  empty secret store.
- **The scheduler and agent workflows will find no providers configured** and will say so by
  name rather than silently doing nothing or falling back to a different model. That is
  correct behaviour for this copy.
- **`pnpm check:clean-room` enforces it** across every file and every commit message, in CI,
  so a key cannot arrive here by accident.

To actually run agents, follow OWNER-TODO 5 and 6 on a private instance.

Blocks: nothing. Recorded so the absence is legible as a decision.
