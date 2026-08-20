# Security

This document states the token-storage model and its trade-offs honestly, including the
parts that are genuinely weaker than a server-backed CMS. If you need a stronger model than
the default, the last section says how to get one.

## Reporting a vulnerability

Open a [security advisory](https://github.com/nazilafeef/dheys-cms/security/advisories/new)
rather than a public issue. If you would rather not use GitHub, note that in a normal issue
without details and someone will find another route.

## The token-storage model

**Dheys CMS holds a GitHub fine-grained personal access token in `sessionStorage`, and
nowhere else.**

### What that buys

- The token dies with the browser tab. Closing it forgets the credential.
- It is bound to one origin. Another site cannot read it.
- This application never writes it to disk, never sends it anywhere except in an
  `Authorization` header to `api.github.com`, and never persists it to `localStorage` — not
  even behind a "remember me", which does not exist.
- Its blast radius is whatever repositories you scoped it to, not your account.

### What it costs

**`sessionStorage` is readable by any script running on this origin.** If an attacker
achieves script execution here — through a compromised dependency, a malicious build
plugin, or a stored-XSS hole — they can read the token.

There is no way to hold a credential in a browser that survives that. `httpOnly` cookies
would, because script cannot read them, but they require a server to set and validate, and
this control plane deliberately has none. That is the trade: no server to run, patch, pay
for or be breached, in exchange for a credential that lives somewhere script can reach.

Saying "we store it securely in the browser" would be marketing. It is stored in the browser,
and that is a real limitation.

### What follows from accepting it

- **Scope the token narrowly.** A fine-grained PAT listing only the repositories you manage,
  with Contents: read and write, and Actions: read and write only if you schedule. Not a
  classic token, and never `repo` on everything.
- **Set an expiry.** Ninety days or less. Rotation is cheap; a leaked token that never
  expires is not.
- **No `unsafe-eval`.** The admin ships no runtime schema compiler and no template
  evaluator, which closes the usual route to script execution in a data-driven admin.
  Validation uses the same Zod schemas the build uses, compiled ahead of time.
- **The Markdown preview renders in an iframe with an empty `sandbox` attribute.** Scripts,
  forms, navigation and same-origin access are all disabled, so a model's output or an
  imported article cannot execute or reach the token. This is stronger than sanitising and
  has no allowlist to keep correct.
- **Dependencies are audited by Dependabot**, grouped weekly.

## Where the AI keys live

Not in the browser. Not in this repository. Not reachable from the control plane at all.

Every provider key is an Actions secret, readable only inside a workflow runner. The admin
does not call a provider; it dispatches a workflow and polls the run through the GitHub API.
That boundary is the whole reason the architecture is shaped this way.

## The clean-room gate

`pnpm check:clean-room` runs in CI on every push and scans **every tracked and untracked
file, plus the entire commit-message history**, for:

- fully-qualified domains outside a short allowlist held in one file
- GitHub repository references other than this one
- anything shaped like a credential — GitHub PATs, provider keys, AWS ids, private key
  blocks, JWTs, and assigned secret literals that look high-entropy

It fails the build rather than warning. Planted violations in the test suite prove each rule
rejects what it claims to.

**Its one documented gap:** a hostname hard-coded bare, with no scheme and no `www.`, inside
a source-file string literal. Scheme-anchored and `www.`-prefixed hosts are caught
everywhere; bare hosts are read in prose and JSON values. The reasoning is in
[DECISIONS.md](./DECISIONS.md) #5.

## Serverless functions

This project ships none. If you add one:

**Set security headers in the function's own response.** Header configuration files —
`netlify.toml`, `vercel.json` header rules, `_headers` — apply to _static assets_. They do
not apply to function responses. Adding a rule there for a function looks correct, passes
review, and does nothing.

## OAuth, if you add it

The default path uses a PAT and has no OAuth flow. If you add one, complete the whole
handshake:

1. The popup announces itself to the opener.
2. The opener echoes back.
3. **The popup validates the opener's origin against an allowlist.**
4. Only then is the token posted.

Skipping step 3 fails silently and is indistinguishable from a bad secret when observed from
outside — which is what makes it so expensive to debug.

And **never render sign-in vocabulary or third-party branding on an OAuth callback page.**
A page shaped like a credential prompt gets reported as phishing, by users and by scanners.
The admin's connect screen already follows this: no "sign in", no lock icons, no GitHub
branding, and an e2e test asserts it.

## Verifying a credential

Check a _configuration value_, not a response shape. `whoAmI()` resolves a token to the
account it belongs to; a 302 or a 200 from some other endpoint proves only that a request
was answered, not that the credential is the one you meant to use.

## A stronger model

If holding a token in a browser is not acceptable for your situation — a shared machine, a
regulated environment, a large team — use a **GitHub App** instead:

1. Create a GitHub App with Contents and Actions permissions, installed on the repositories
   you manage.
2. Host the token exchange somewhere with a server (a single serverless function is enough).
3. Have it issue short-lived installation tokens rather than handing the browser a PAT.

That moves the credential out of the browser entirely, at the cost of the thing this project
is built around: having nothing to run. It is a real trade and a reasonable one to make.
The rest of the CMS is unaffected — the GitHub client takes a token and does not care where
it came from.
