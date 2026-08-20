# Automation and scheduling

Two workflows do all of it: `scheduler.yml` publishes what is due, and `agent-run.yml` makes
an agent write something. Both run in GitHub Actions, which is the only place in this system
that holds an AI key.

## The scheduler

Runs every fifteen minutes, and on demand.

```
1. read the kill switch — stop if it is on
2. load the registry
3. for each site, read its content directory through the GitHub API
4. validate every item and evaluate its guardrails
5. decide what is due
6. commit what publishes, then trigger that site's deploy adapter
```

The decision logic is pure and unit-tested; the workflow is only the part that touches the
world.

### Cron is not punctual

GitHub delays scheduled workflows under load, sometimes by many minutes, and occasionally
drops a firing. Three consequences, all handled rather than assumed away:

**Nothing assumes exact-minute firing.** "Due" means `dueAt <= now`, never `dueAt === now`.

**A missed window publishes late, not never.** An item whose slot passed four hours ago goes
out, flagged as a catch-up. Silently dropping something an operator scheduled is the worse
failure, and it is the one nobody notices.

**Every tick is idempotent.** An item whose committed state is already `published` is
skipped. Running the same tick twice produces the same decisions — a double publish means a
duplicate commit, a duplicate deploy, and a duplicate entry in every feed reader that
already saw it.

There is no separate database to fall out of step with the repository: the committed state
_is_ the ledger.

### Publish timing

**Fixed** — `schedule.at`, an exact instant.

**Windowed** — "between 08:00 and 11:00 on a weekday", in a named IANA zone:

```json
{
  "window": {
    "from": "08:00",
    "to": "11:00",
    "timezone": "Indian/Maldives",
    "days": [0, 1, 2, 3, 4]
  }
}
```

The time inside the window is randomised, but **seeded per item and per day**, so it is
deterministic. A scheduler that re-rolled the offset every tick would move an item's slot
every fifteen minutes and could publish it hours from where the operator saw it in the
calendar.

**Embargo** — `schedule.embargoUntil` can only ever push publication later, never earlier,
even for an approved item.

**Drip** — spread a batch across a date range at a set rate per day.

Time zones are handled properly: a wall-clock time in a named zone is converted to a UTC
instant, resolved twice so a time falling across a daylight-saving change lands on the right
offset.

### Approval policies

| Policy           | Behaviour                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `human-required` | Never publishes without an explicit human approval. **The default.**                                                    |
| `human-optional` | Enters the queue with a deadline. A human decision governs; if the deadline lapses with no decision, it auto-publishes. |
| `auto`           | Publishes on schedule with no human step. Guardrails still apply and still block.                                       |

An item that auto-publishes on a lapsed deadline records _both_ reasons in its log — why it
was due, and why it published without approval. A boolean nobody reads is not an audit trail.

### The kill switch

A repository **variable**, `DHEYS_PUBLISHING_HALTED`. Set it to `true` and nothing publishes
on any site — no redeploy, no commit, no workflow edit.

```
Settings → Secrets and variables → Actions → Variables
DHEYS_PUBLISHING_HALTED = true
```

It **fails closed**. If the variable cannot be read at all, the tick assumes it is on:
publishing something an operator has halted is far worse than publishing it fifteen minutes
late.

Guardrails are checked _before_ the kill switch, so the log still shows what is being held
back and why.

## The agent runner

Dispatched from the admin or by `workflow_dispatch`:

```
1. load the registry and the site
2. estimate the cost and check it against the caps  ← before anything is spent
3. resolve a configured provider
4. run the job
5. put the result through intake — the same door every provider uses
6. commit an accepted item as in-review, never as published
```

**This runner has no path that publishes.** Publication is the scheduler's job and goes
through the guardrails.

### Cost control

Caps are enforced **before dispatch**, not reported afterwards. Automated commissioning turns
a per-article cost into a per-month cost nobody watches until the invoice arrives.

- Per-site and global monthly caps, from the registry.
- Estimation before, real accounting after. The ledger always holds what the provider
  actually charged.
- An unpriced model is **not free**: it estimates at the job's own `maxCostUsd` ceiling, so
  it is treated as expensive rather than invisible.
- A blocked run needs an explicit override, which is recorded. Nothing infers one.

```
Site "example-news" has reached its monthly cap: $24.90 of $25.00 used, and this run
would take it to $25.90. Dispatch is blocked until the cap is raised or a person
overrides it.
```

### Commissioning

A commission holds a brief, a target site, locales, a content type, an agent chain and its
timing — immediate, a fixed datetime, a recurring cron, or trigger-based. Commissions live
in the registry storage, so they are versioned and reviewable like anything else.

## Secrets

| Secret                                                       | For                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DHEYS_SITE_TOKEN`                                           | Writing to connected site repositories. **Not** the workflow token — that cannot reach another repository, which is the intended boundary. |
| `SITE_REGISTRY_JSON`                                         | The registry, if you store it inline.                                                                                                      |
| `ANTHROPIC_API_KEY` etc.                                     | Providers. Each is opt-in; an unset key means that provider is unavailable and `resolveProvider` says so by name.                          |
| `CLOUDFLARE_API_TOKEN`, `NETLIFY_AUTH_TOKEN`, `VERCEL_TOKEN` | Confirming a deploy actually finished.                                                                                                     |

## Running it by hand

```bash
pnpm scheduler:tick --dry-run     # decide and report, commit nothing
pnpm scheduler:tick               # act

pnpm agent:run --site example-news --job write --brief "..." --dry-run
```

## Related

- [guardrails.md](./guardrails.md) · [agent-job-contract.md](./agent-job-contract.md) ·
  [site-registry.md](./site-registry.md) · [configuration.md](./configuration.md)
