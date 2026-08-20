# Contributing

## Before you open a pull request

```bash
pnpm gate
```

Typecheck, lint, unit tests, the clean-room gate, the build and the link check. It runs in
CI on Node 20 and 22 anyway, so running it locally only saves you a round trip.

For anything touching the front end or the admin:

```bash
pnpm test:e2e
pnpm lighthouse
```

## The rules that are not negotiable

**No `any`.** ESLint enforces it. If a type is genuinely unknown, it is `unknown` and you
narrow it.

**No credential, domain or foreign repository reference in a committed file** — including
tests, examples, comments and commit messages. `pnpm check:clean-room` scans the tree _and_
the commit history, and fails the build. Demo content uses `example.com` and friends.

**No test may reach a real AI provider or the real GitHub API.** Every provider and every
client takes its transport by injection, which makes this a property of the design rather
than a promise. If you find yourself wanting a network call in a test, the seam is missing.

**Thresholds do not move.** Lighthouse is ≥95 in all four categories, the article-page
JavaScript budget is 30 KB, and contrast is 4.5:1. If a change cannot meet them, fix the
cause; if the cause is a feature, remove or defer it.

**Logical CSS properties only.** `margin-inline-start`, never `margin-left`. Two of the three
shipped locales are right-to-left.

**Include `\p{M}` in any regex over text.** Thaana vowels and Arabic harakat are combining
marks, not letters. This has caused three real bugs in this codebase: heading anchors, word
counts and reading times.

## Dependencies

Adding one needs a sentence saying what it replaces and why writing it is worse. This project
prefers deleting code to adding options, and it prefers owning fifty lines to taking a
dependency whose allowlist has to be kept correct forever.

Anything with a known CVE is upgraded or replaced, not shipped.

## Tests

A test should name the failure it prevents. `"rejects an item with no category"` is useful;
`"validates correctly"` is not.

Where a comment explains _why_ something is the way it is, keep it near the code. The
comments in this codebase carry the reasoning that would otherwise be lost — several of them
exist because a subtle bug was found and fixed, and the comment is what stops it coming back.

**Never skip a flaky test, never mark it `.todo`, and never add a retry to hide it.** Fix the
flakiness. The Lighthouse gate takes a discarded warm-up run rather than retrying, which is
the shape to aim for.

## Commits

Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

Say what changed and why, not what a diff already shows. If a change fixes something subtle,
the message is the right place to explain what was actually wrong.

Commit messages are scanned by the clean-room gate too.

## Documentation

If a change alters behaviour an operator can observe, update the relevant file in `docs/` in
the same pull request. Documentation that lags behind the code is worse than none, because
people trust it.

Judgement calls that the code cannot express get a line in [docs/DECISIONS.md](./docs/DECISIONS.md).

## Getting started

Good first issues: a locale (see [docs/i18n-and-rtl.md](./docs/i18n-and-rtl.md)), a deploy
adapter, a content adapter, a provider (see
[docs/writing-a-provider.md](./docs/writing-a-provider.md)), or a framework signature for the
connector.

## Conduct

[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Be decent; assume good faith; keep disagreements
about the work.
