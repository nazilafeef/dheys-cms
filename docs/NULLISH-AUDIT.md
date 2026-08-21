# Nullish and falsy audit

A sweep of every `??` and every falsy-fallback `||` in `src/` and `scripts/`, looking for one
shape: **an operand that can be _present but empty_**, where the code assumes present means
meaningful.

`??` only asks "is this null or undefined". `||` asks "is this falsy", which is a different
and wider question. Both get the wrong answer when a value legitimately is `{}`, `[]`, `''`
or `0` — and Zod defaults, GitHub Actions expressions, form fields and query strings all
produce exactly those.

Safe cases are listed too. An audit that only shows what it changed cannot be reviewed.

---

## Found and fixed

| Site                                | Shape                                      | What went wrong                                                                                                                                       | Fix                                          |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `cost.ts` `estimateCost`            | `input.rates ?? DEFAULT_MODEL_RATES`       | Schema defaults `modelRates` to `{}`; not nullish, so it won. Every model priced at its ceiling, and the monthly cap became a job counter.            | Merge the tables (DECISIONS 69)              |
| `runner-env.ts` and three providers | `env['X'] ?? fallback`                     | Actions expands an unset secret to `''`, not `undefined`. Three model names became empty strings; two timeouts became `Number('') === 0`.             | `envOr` (DECISIONS 70)                       |
| `site-registry.ts` `capsFrom`       | `site.agents.monthlyCapUsd > 0`            | `.default(0)` erased "no cap" vs "may not spend"; `> 0` then made a deliberate zero mean _unlimited_, while the same `0` globally blocked everything. | `.optional()` + presence test (DECISIONS 73) |
| `cost.ts` `checkDispatch`           | unpriced estimate treated as a real number | An invented ceiling was enforced against as though it were a price.                                                                                   | Refuse by name (DECISIONS 72)                |

---

## Checked and safe

### `??` over collections

| Site                                               | Why it is safe                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `providers/types.ts` `options.sources ?? []`       | Falls back to an empty array. An empty left operand produces the same result.      |
| `agent-run.ts` `…split(',').filter(Boolean) ?? []` | Same — the fallback _is_ empty, so the distinction cannot matter.                  |
| `connector/routes.ts` `after.redirects ?? {}`      | Same.                                                                              |
| `collections.ts` `counts.get(tag) ?? 0`            | A `Map` miss really is `undefined`; `0` is a legitimate value and is preserved.    |
| `github.ts` rate-limit header reads                | Explicit `=== null \|\| === undefined` checks, not `??`. Correct as written.       |
| `site-registry.ts` `guardrailsFor`                 | Already `length > 0 ? … : DEFAULT_GUARDRAILS` — the pattern `estimateCost` needed. |
| `scheduler.ts` `window.days.length === 0 \|\| …`   | Explicit length test; an empty array means "every day" deliberately.               |

### `??` over scalars

| Site                                                     | Why it is safe                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `deploy-adapters.ts` timeout and interval                | Options object built in code, never from a schema default or an env var. |
| `i18n.ts` `MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE]` | A lookup miss is genuinely `undefined`.                                  |
| `providers/*` token-count reads `?? 0`                   | Falls back to `0`, which is also what an absent count means.             |
| `webhook.ts` `ctx.sleep ?? (…)`                          | A function or nothing; no empty form exists.                             |
| `cost.ts` `input.timeZone ?? 'UTC'`                      | An empty timezone is not a legitimate value, and no caller supplies one. |

### `||` fallbacks

| Site                                                                   | Why it is safe                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections.ts`, `connector/analyse.ts` comparators                   | `b.count - a.count \|\| a.name.localeCompare(…)` — the classic tie-break idiom. `0` means "equal", which is exactly when the secondary sort should run. |
| `guardrails.ts`, three providers: `issue.path.join('.') \|\| '(root)'` | An empty path _is_ the root. Falling back on empty is the intent.                                                                                       |
| `MarkdownEditor.tsx` `value.slice(start, end) \|\| action.placeholder` | An empty selection should use the placeholder. Intended.                                                                                                |
| `scheduler.ts` `window.timezone \|\| options.defaultTimezone`          | An empty timezone string is meaningless, so falling back on it is correct — `??` here would be _worse_.                                                 |
| All `a === b \|\| c === d` forms                                       | Boolean comparisons, not fallbacks. Out of scope by construction.                                                                                       |

### Deliberately left alone

| Site                                       | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-run.yml` `inputs.max_cost \|\| '2'` | A GitHub expression, not TypeScript. `max_cost` is a **string** input, and a non-empty string is truthy in that language — `'0'` survives. A numeric `0` from `client_payload` would not, but the ceiling exists to bound a run, and a run bounded at zero has nothing to do; the default is the safer outcome either way. Noted rather than changed, because changing it means expression gymnastics for a case that cannot currently arise. |
| `globalMonthlyCapUsd` default `0`          | `0` blocking everything is the safe direction for a default: a budget must be set deliberately. Left as it was, and now documented in the schema.                                                                                                                                                                                                                                                                                             |

---

## The rule this leaves behind

Where a field has a legitimate empty or zero value, **it must be optional**, so that "unset"
and "set to nothing" remain different facts. A schema default that coincides with a
meaningful value destroys information before any code gets to read it — `{}` for rates, `0`
for a cap, and the next one will be something else.
