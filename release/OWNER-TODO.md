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

**2. Supply the Dheys logo.** — *1 minute once the file exists, cosmetic*

Drop the artwork at `src/assets/brand/dheys-logo.svg`. Until it is there the Dheys theme
renders a text wordmark placeholder and the build prints a warning naming that exact path.
No substitute logo has been drawn, deliberately.

Blocks: nothing functional. The Dheys theme looks unfinished without it.

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

**5. Set the AI provider keys you actually intend to use.** — *5 minutes per provider*

No `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` was present in the build
environment, so every provider is built and tested against mocks and none has been
exercised against a live endpoint. Add the ones you want as Actions secrets; providers are
opt-in and the CMS runs fine with none of them.

Blocks: agent commissioning. Nothing else.

---

**6. Choose where the site registry lives.** — *10 minutes*

The registry never lives in this repository. Pick one of the three documented options in
`docs/site-registry.md` — a private gist, a private companion repository, or a repository
secret — and point the deployment at it. Until then the admin has no sites to manage and
says so.

Blocks: connecting any real site.
