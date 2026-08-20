# Using the admin

`/admin` is a single Preact island and the only page on the site that ships a component
framework. Everything else is static HTML.

## Connecting

Paste a GitHub **fine-grained** personal access token.

- **Repository access:** only the repositories you manage.
- **Contents:** read and write.
- **Actions:** read and write, if you want to schedule or commission.
- **Expiry:** 90 days or less.

The token is held in `sessionStorage` for that browser tab and nowhere else. Closing the tab
forgets it. It is never written to disk and never leaves the browser except in an
`Authorization` header to `api.github.com`. Read [SECURITY.md](./SECURITY.md) for what that
does and does not protect against — it is stated honestly, including the parts that are
weaker than a server-backed CMS.

Connecting resolves the token to an identity rather than probing an endpoint for a 200. A
200 proves a request was answered, not whose credential it was.

## Dashboard

Sites you hold a role on, spend this month against the cap, and whether the kill switch is
on. Sites you have no role on do not appear at all.

## Content

Everything in one locale of one site, with search and a state filter.

Files that exist but do not validate are **shown**, with the failing field, rather than
hidden. An item the admin quietly skips is an item an editor cannot find or fix — and a
hand-edited or imported file is exactly where that happens.

### The editor

- Markdown toolbar, and a live preview beside it.
- SEO panel: meta title and description with character counters against what search results
  actually truncate at, plus a social preview.
- Slug generation with collision detection against the repository.
- A Thaana punctuation warning while you type, not at publish time.
- An unsaved-changes guard.

**Every save is a commit.** There is no draft store and no autosave buffer: an edit either
reached the repository or it did not, and the difference is visible in git rather than
inferred from a spinner.

The blob sha read with the file is handed back on write. If someone else changed the file in
between, GitHub returns 409 and the editor says _"reload and reapply"_ rather than
overwriting their work.

The preview renders in an iframe with an empty `sandbox` attribute — no scripts, no
same-origin access — because the body being previewed is frequently a model's output or an
import rather than your own prose.

## Review queue

Everything awaiting a decision, across every locale of a site, with the guardrail verdict
computed **before** anyone decides. You learn a piece is missing its disclosure while you are
deciding about it, not after approving it and watching the scheduler refuse.

- **Approve** — records a human decision and commits it. It does **not** publish; the
  scheduler does that later, after re-checking the guardrails.
- **Request changes** — with a note, which feeds a rewrite job.
- **Reject** — with a reason.

A blocked item's approve button is genuinely disabled, and hovering it says which rule.

AI-authored items show model, tokens and real cost inline.

## Keyboard and mobile

Every control is reachable by keyboard, focus is always visible, and the layout works on a
phone. The admin is RTL-correct: in Dhivehi or Arabic it lays out from the right, not merely
labels itself as such.

## What is not wired up

**Agent runs** and **settings** are not built in this release. Commissioning is available
through `workflow_dispatch` on the `agent-run` workflow, and through `pnpm agent:run`. See
`release/REPORT.md` for exactly what is and is not built.
