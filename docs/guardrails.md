# Guardrails

A guardrail is not a lint and not a warning. If a rule fails, **the item does not publish** —
the scheduler refuses it, the review queue shows it as blocked, and the operator gets a
sentence naming the site, the item and the rule in plain language.

Guardrails apply to every route into a site repository: human commits from the admin, agent
output that cleared intake, and scheduled auto-publishes. The `auto` approval policy skips
the human step; it does not skip these.

## The default set

Every site gets these unless it replaces them:

```json
[
  { "type": "required-disclosure", "kind": "affiliate" },
  { "type": "required-disclosure", "kind": "ai" },
  { "type": "thaana-punctuation" }
]
```

The affiliate rule ships **on** deliberately. Undisclosed affiliate content is a legal
exposure in most jurisdictions this CMS is likely to be used in, so opting _in_ would be the
wrong default — an operator who never opens the guardrail configuration still cannot publish
an item carrying an affiliate offer without disclosing it.

## The rules

### `required-disclosure`

```json
{ "type": "required-disclosure", "kind": "affiliate" | "ai" | "sponsored" }
```

**affiliate** — blocks when the item carries an offer and has no disclosure. It does not
merely trust the `affiliate.hasOffers` flag: the body is scanned for affiliate markers
(`?tag=`, `?ref=`, `?aff=`, `&partner=`, "affiliate link", an `<!-- affiliate -->` comment),
because the case worth catching is the one where nobody ticked the box.

**ai** — blocks AI-authored content that carries no provenance.

**sponsored** — blocks sponsored content with no disclosure.

### `required-fields`

```json
{ "type": "required-fields", "fields": ["heroImageAlt", "seo.description"] }
```

Dotted paths are read into the item. Empty strings and empty arrays count as missing. Each
absent field is reported separately.

### `banned-phrases`

```json
{ "type": "banned-phrases", "phrases": ["guaranteed returns", "risk free"], "caseSensitive": false }
```

Searches the title, the excerpt and the body. Every match is reported, not just the first.

### `minimum-words`

```json
{ "type": "minimum-words", "count": 250 }
```

Markdown syntax and fenced code are excluded from the count. Thaana and Arabic words count
correctly — a naive word pattern breaks a Dhivehi word at every vowel mark and overcounts by
roughly two and a half times, which would wave through an article at a third of the required
length.

### `human-review-required`

```json
{ "type": "human-review-required" }
```

Blocks until a **person** has approved it. An agent approval does not satisfy it, and
neither does the scheduler auto-approving on a lapsed deadline — that distinction is the
whole point of the rule.

This rule is evaluated at **publish time only**. Judging it in the review queue would be
circular: the reviewer could never approve, because they had not yet approved.

### `locale-completeness`

```json
{ "type": "locale-completeness", "locales": ["dv", "en"] }
```

Blocks until the item exists in every named locale. Translations are linked by
`translationOf` pointing at the original's slug.

### `thaana-punctuation`

```json
{ "type": "thaana-punctuation" }
```

Blocks Latin `,` `;` `?` inside Thaana text, naming the character position. This is a
correctness rule, not a style preference: Latin punctuation inside a right-to-left run
renders with the wrong directional class and visibly breaks the line.

Use `،` (U+060C), `؛` (U+061B) and `؟` (U+061F).

## Where they run

**In the review queue**, before anyone decides — so an editor learns a piece is missing its
disclosure while they are deciding about it, not after approving it and watching the
scheduler refuse. Publish-time-only rules are excluded here.

**In the scheduler**, on every tick, on the full rule set. An item that passed review and
then had its disclosure edited out is caught here.

**In the schema**, for affiliate disclosure specifically. Putting that rule in the interface
would mean it held only for items a human typed; putting it in the schema means it binds
agent output, imports and direct commits too.

## Errors

Plain language, naming site, item and rule:

```
Example News: "Choosing a tide clock" needs the affiliate disclosure before it can publish.
Example News: "A short piece" is 84 words; this site requires at least 250.
Example News: "ދިވެހި ސުރުޚީ" uses Latin punctuation inside Thaana text at position 42.
```

They are localised — an operator working in Dhivehi gets them in Dhivehi.

## Adding one

Guardrails are data, in the registry. There is no code to write for the rules above.

For a genuinely new _kind_ of rule, add a variant to `guardrailRuleSchema` and a `case` to
`evaluateRule` in `src/lib/guardrails.ts`, plus a message key in each locale file. The
switch is exhaustive, so TypeScript will tell you what you have missed.

## Related

- [automation.md](./automation.md) — when the scheduler evaluates them
- [site-registry.md](./site-registry.md) — where they are configured
- [i18n-and-rtl.md](./i18n-and-rtl.md) — the Thaana punctuation rule in context
