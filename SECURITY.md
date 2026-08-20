# Security policy

## Reporting a vulnerability

Open a [security advisory](https://github.com/nazilafeef/dheys-cms/security/advisories/new)
rather than a public issue. If you would rather not use GitHub, open a normal issue saying
only that you have a security report and someone will find another route.

Please include what you can: what an attacker achieves, how to reproduce it, and which
version or commit you tested.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | yes       |

## The threat model, in one paragraph

The control plane is a static site with no server. It holds a GitHub token in
`sessionStorage` for one browser tab, talks only to `api.github.com`, and never touches an
AI provider. Every provider key lives in GitHub Actions secrets, readable only inside a
workflow runner. The token in the browser is readable by any script running on that origin —
there is no way around that without a server, and the trade-offs, mitigations, and the
GitHub App path for operators who need something stronger are set out in full in
**[docs/SECURITY.md](./docs/SECURITY.md)**.

Read that document before deploying this for anyone but yourself.
