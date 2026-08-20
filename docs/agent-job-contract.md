# The agent job contract

Anything that produces content for Dheys CMS — a direct provider call, an external pipeline
reached by webhook, or your own script — returns a job result in this shape. The contract is
enforced at intake, before a single byte reaches a site repository, and it is strict on
purpose.

You can implement against this document alone. Nothing here requires reading the source.

## Why it is strict

The two fields agents most reliably drop in practice are `category` and `publishedDate`.

Ask a model for "an article about X" and it returns prose, a title and usually an excerpt.
It omits the taxonomy and the date, because nothing in the request made those feel like part
of the writing. The site build then fails on a collection schema three hours later, or —
worse — succeeds, and publishes an item dated the Unix epoch at the bottom of the archive
where nobody looks.

So both are required, both are checked by name, and an item missing either is rejected at
the door with a message naming the field.

## The eight required fields

Non-negotiable. An item missing any one of them is rejected, never written to a site
repository, and shown in the review queue as a failed job.

| Field           | Type                                           | Notes                                                                                                  |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `title`         | string                                         | Non-empty.                                                                                             |
| `slug`          | string                                         | Lowercase Latin letters, digits, single hyphens. Transliterate non-Latin titles; never percent-encode. |
| `category`      | string                                         | One of the site's categories. Do not invent one.                                                       |
| `publishedDate` | ISO 8601 string                                | Coerced to a date. A malformed value is an error, not a zero.                                          |
| `excerpt`       | string                                         | Non-empty, at most 400 characters.                                                                     |
| `locale`        | `en` \| `dv` \| `ar`                           | Must be a locale the site declares.                                                                    |
| `author`        | string                                         | Byline as displayed.                                                                                   |
| `sourceType`    | `human` \| `ai` \| `ai-assisted` \| `imported` | Set by the runner for provider output; see below.                                                      |

## Provenance

Every AI-authored item carries provenance, and it is **built from the dispatch record, not
from the model's output**. An agent is never trusted to report what it cost or which model
it was: the run id, timings, token counts and cost come from the runner's own accounting.

If your pipeline returns a `provenance` block, it is discarded and rebuilt. What you must
return is `usage`, and it must be honest.

```
provenance:
  model          string    the model that produced it
  provider        string    the provider id
  promptVersion   string    version of the prompt template used
  runId           string    echoes the request's runId
  jobType         string
  sources         array     { title, url, accessedAt?, unsupportedClaims? }
  tokensIn        integer
  tokensOut       integer
  costUsd         number    real cost, from the provider's own accounting
  startedAt       ISO 8601
  completedAt     ISO 8601
  reviewedBy      string?   set when a person approves it
```

Provenance is rendered as an attribution line the theme can display or suppress. **AI
content is never published under a bare human byline** — that rule is enforced in the
schema, not in the interface, so it binds imports and direct commits too.

## Job types

`research` · `write` · `rewrite` · `translate` · `seo-optimise` · `fact-check` · `image-alt`

Jobs compose into chains — a site's registry entry names them, for example
`news: ["research", "write", "fact-check", "seo-optimise"]`.

## The request

```json
{
  "runId": "run-2026-06-10-0042",
  "jobType": "write",
  "siteId": "example-news",
  "locale": "dv",
  "brief": "Write about the tide gauge readings released this week.",
  "promptVersion": "news-brief@3",
  "maxCostUsd": 2,
  "allowedCategories": ["environment", "media", "guides"],
  "targetLocale": null,
  "commissionId": null
}
```

`maxCostUsd` is a ceiling, not a suggestion. The cost check happens _before_ dispatch.

## The result

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nazilafeef.github.io/dheys-cms/schemas/agent-job-result.json",
  "title": "Dheys CMS agent job result",
  "type": "object",
  "required": ["runId", "jobType", "status", "startedAt", "completedAt", "promptVersion"],
  "additionalProperties": false,
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "jobType": {
      "type": "string",
      "enum": [
        "research",
        "write",
        "rewrite",
        "translate",
        "seo-optimise",
        "fact-check",
        "image-alt"
      ]
    },
    "status": { "type": "string", "enum": ["completed", "failed"] },
    "startedAt": { "type": "string", "format": "date-time" },
    "completedAt": { "type": "string", "format": "date-time" },
    "promptVersion": { "type": "string", "minLength": 1 },
    "error": { "type": "string" },
    "body": { "type": "string" },
    "usage": {
      "type": "object",
      "required": ["tokensIn", "tokensOut", "costUsd", "model", "provider"],
      "properties": {
        "tokensIn": { "type": "integer", "minimum": 0 },
        "tokensOut": { "type": "integer", "minimum": 0 },
        "costUsd": { "type": "number", "minimum": 0 },
        "model": { "type": "string", "minLength": 1 },
        "provider": { "type": "string", "minLength": 1 }
      }
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "url"],
        "properties": {
          "title": { "type": "string", "minLength": 1 },
          "url": { "type": "string", "format": "uri" },
          "accessedAt": { "type": "string", "format": "date-time" },
          "unsupportedClaims": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "item": {
      "type": "object",
      "required": [
        "title",
        "slug",
        "category",
        "publishedDate",
        "excerpt",
        "locale",
        "author",
        "sourceType"
      ],
      "properties": {
        "title": { "type": "string", "minLength": 1 },
        "slug": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        "category": { "type": "string", "minLength": 1 },
        "publishedDate": { "type": "string", "format": "date-time" },
        "excerpt": { "type": "string", "minLength": 1, "maxLength": 400 },
        "locale": { "type": "string", "enum": ["en", "dv", "ar"] },
        "author": { "type": "string", "minLength": 1 },
        "sourceType": { "type": "string", "enum": ["human", "ai", "ai-assisted", "imported"] },
        "tags": { "type": "array", "items": { "type": "string" } },
        "heroImageAlt": { "type": "string" },
        "seo": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "maxLength": 70 },
            "description": { "type": "string", "maxLength": 180 },
            "noindex": { "type": "boolean" }
          }
        }
      }
    }
  }
}
```

### A worked example

A completed `write` job for the invented site `example-news`:

```json
{
  "runId": "run-2026-06-10-0042",
  "jobType": "write",
  "status": "completed",
  "startedAt": "2026-06-10T06:12:00.000Z",
  "completedAt": "2026-06-10T06:13:41.000Z",
  "promptVersion": "news-brief@3",
  "usage": {
    "tokensIn": 18420,
    "tokensOut": 2980,
    "costUsd": 0.166,
    "model": "claude-opus-5",
    "provider": "anthropic"
  },
  "sources": [
    {
      "title": "Harbour authority annual report 2025",
      "url": "https://example-news.example.com/reports/2025",
      "accessedAt": "2026-06-10T06:10:00.000Z"
    }
  ],
  "item": {
    "title": "Reading the monsoon from a century of notes",
    "slug": "reading-the-monsoon-from-a-century-of-notes",
    "category": "environment",
    "publishedDate": "2026-06-10T08:00:00.000Z",
    "excerpt": "The harbour ledgers were never meant to record weather. They did anyway.",
    "locale": "en",
    "author": "Aminath Rasheed",
    "sourceType": "ai",
    "tags": ["tides", "weather", "archives"],
    "heroImageAlt": "An open ledger page showing columns of handwritten numbers.",
    "seo": {
      "description": "Marginal notes in a century of tide ledgers hold a usable record of monsoon onset.",
      "noindex": false
    }
  },
  "body": "The people keeping the tide ledgers were not recording the weather...\n"
}
```

### A rejection

Return `status: "failed"` with a reason. Do not return a half-item.

```json
{
  "runId": "run-2026-06-10-0043",
  "jobType": "write",
  "status": "failed",
  "startedAt": "2026-06-10T06:12:00.000Z",
  "completedAt": "2026-06-10T06:12:04.000Z",
  "promptVersion": "news-brief@3",
  "error": "rate limited after 3 attempts"
}
```

## What intake does with it

1. Parses the result. A malformed payload is rejected with the run id if one can be found.
2. `status: "failed"` is recorded as a failed job with the provider's reason.
3. Missing required fields are reported **separately from invalid ones** — "category is
   missing" and "category is not one of this site's categories" need different fixes.
4. Provenance is rebuilt from the dispatch record for AI-authored items.
5. An accepted item is committed as **`in-review`**, never as published. The runner has no
   path that publishes; the scheduler does that later, after guardrails.

## Implementing a pipeline

Return the shape above from an HTTPS endpoint and set `EXTERNAL_AGENT_URL`. The full
request is POSTed to you verbatim.

For a long-running pipeline, acknowledge and defer:

```json
{ "status": "accepted", "pollUrl": "https://your-pipeline.example.com/jobs/42" }
```

The runner polls that URL until it returns a job result. Long generations belong in a
background workflow with status polling, never inside a request that can time out.

**Your result must echo the `runId` it was asked for.** A result answering a different run
is refused: accepting it would file one job's output, cost and provenance against another.

## Related

- [writing-a-provider.md](./writing-a-provider.md) — implementing the in-process interface
- [automation.md](./automation.md) — dispatch, cost caps and the scheduler
- [guardrails.md](./guardrails.md) — what still has to pass before anything publishes
