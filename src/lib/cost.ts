/**
 * Cost control.
 *
 * Automated commissioning turns a per-article cost into a per-month cost that nobody
 * watches until the invoice arrives. Caps here are therefore enforced *before dispatch*,
 * not reported afterwards: a run that would take a site past its cap does not start.
 *
 * Two design choices are deliberate:
 *
 *  - Estimation before, accounting after. `estimateCost` guesses from a rate table so a
 *    cap can be checked before spending anything; `recordRun` stores what the provider
 *    actually charged. The ledger is always the real number, never the estimate.
 *
 *  - An unknown model is not free. If a model has no rate, estimation refuses to return
 *    zero -- it falls back to the job's own `maxCostUsd` ceiling, so a model the
 *    operator has not priced is treated as expensive rather than invisible.
 */

/** Rate for a model, in US dollars per million tokens. */
export interface ModelRate {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/**
 * Default rates for the models this CMS ships providers for.
 *
 * Published rates move. This table is the fallback, not the authority: a site may
 * override any entry through `modelRates` in its registry definition, and every ledger
 * entry stores the cost the provider itself reported. Rates for non-Anthropic models
 * are deliberately absent rather than guessed -- see `docs/automation.md` for how to
 * set them.
 */
export const DEFAULT_MODEL_RATES: Readonly<Record<string, ModelRate>> = Object.freeze({
  'claude-fable-5': { inputPerMillion: 10, outputPerMillion: 50 },
  'claude-opus-5': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-opus-4-8': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-opus-4-7': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-opus-4-6': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
});

export interface CostLedgerEntry {
  readonly runId: string;
  readonly siteId: string;
  readonly model: string;
  readonly provider: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** What the provider actually charged. Never an estimate. */
  readonly costUsd: number;
  readonly at: Date;
}

export interface CostCaps {
  /** Ceiling across every site combined. */
  readonly globalMonthlyUsd: number;
  /** Per-site ceilings. A site with no entry is bounded only by the global cap. */
  readonly perSiteMonthlyUsd: Readonly<Record<string, number>>;
}

/**
 * Calendar month key in a fixed zone. Billing months are calendar months, so a run at
 * 23:30 on the 31st must land in the month the operator would put it in, not in
 * whatever month UTC happens to be in.
 */
export function monthKey(instant: Date, timeZone = 'UTC'): string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts['year']}-${parts['month']}`;
}

export interface EstimateInput {
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly rates?: Readonly<Record<string, ModelRate>>;
  /** The job's own ceiling, used when the model has no known rate. */
  readonly fallbackUsd?: number;
}

export interface CostEstimate {
  readonly costUsd: number;
  /** False when the figure came from `fallbackUsd` because the model is unpriced. */
  readonly rateKnown: boolean;
  readonly model: string;
}

export function estimateCost(input: EstimateInput): CostEstimate {
  /*
   * Per-site rates *override* the shipped table; they do not replace it.
   *
   * This was `input.rates ?? DEFAULT_MODEL_RATES`, and the site schema defaults
   * `agents.modelRates` to `{}`. An empty object is not nullish, so `??` kept it — and every
   * site that had not written its own rate table, which is every site by default, priced
   * every model at its job ceiling. A live run against Claude Opus 5 reported "model has no
   * known rate" and estimated the full $1.00 ceiling for what should have cost a fraction of
   * a cent.
   *
   * Not a cosmetic error: the monthly cap is enforced against these estimates, so a $25 cap
   * admitted 25 jobs regardless of what they actually cost, and the ledger's relationship to
   * reality was decided by a `??`.
   *
   * Merging keeps all three intended behaviours — shipped models price correctly, a site can
   * override any rate it disagrees with, and a genuinely unknown model still falls through to
   * `fallbackUsd` (the job ceiling) rather than being treated as free.
   */
  const table: Readonly<Record<string, ModelRate>> = { ...DEFAULT_MODEL_RATES, ...input.rates };
  const rate = table[input.model];
  if (!rate) {
    return {
      costUsd: input.fallbackUsd ?? 0,
      rateKnown: false,
      model: input.model,
    };
  }
  const cost =
    (input.tokensIn / 1_000_000) * rate.inputPerMillion +
    (input.tokensOut / 1_000_000) * rate.outputPerMillion;
  return { costUsd: round(cost), rateKnown: true, model: input.model };
}

/** Total real spend in a month, optionally for one site. */
export function spendInMonth(
  ledger: readonly CostLedgerEntry[],
  month: string,
  siteId?: string,
  timeZone = 'UTC',
): number {
  return round(
    ledger
      .filter((entry) => monthKey(entry.at, timeZone) === month)
      .filter((entry) => siteId === undefined || entry.siteId === siteId)
      .reduce((total, entry) => total + entry.costUsd, 0),
  );
}

export interface DispatchCheckInput {
  readonly caps: CostCaps;
  readonly ledger: readonly CostLedgerEntry[];
  readonly siteId: string;
  readonly estimatedCostUsd: number;
  /**
   * Whether `estimatedCostUsd` came from a real rate or from a guess.
   *
   * Optional so existing callers keep working, but pass it: an estimate the pricing table
   * could not produce is not a number the cap can be enforced against, and `false` is the
   * only value that makes this check do its job.
   */
  readonly rateKnown?: boolean;
  readonly now: Date;
  /** Explicit operator action. Never inferred, never defaulted to true. */
  readonly override?: boolean;
  readonly timeZone?: string;
  /** Named in the refusal when the model has no rate. */
  readonly model?: string;
}

export interface DispatchVerdict {
  readonly allowed: boolean;
  /** True when only an explicit override would let this through. */
  readonly requiresOverride: boolean;
  readonly reason: string;
  readonly scope: 'site' | 'global' | 'none' | 'unpriced';
  readonly spentUsd: number;
  readonly capUsd: number;
  readonly remainingUsd: number;
  readonly projectedUsd: number;
}

/**
 * Decide whether a run may start. Checked against the site cap first, then the global
 * cap, because an operator hitting the global cap needs to know that no site can
 * dispatch, not just this one.
 */
export function checkDispatch(input: DispatchCheckInput): DispatchVerdict {
  const timeZone = input.timeZone ?? 'UTC';
  const month = monthKey(input.now, timeZone);

  /*
   * An unpriced model is refused before the caps are even consulted.
   *
   * The old behaviour was to price it at the job ceiling and carry on, which reads as
   * conservative and is not. The ceiling is what the *dispatcher* was willing to spend on
   * one run, not what the model costs; it is a number this code invented. Enforcing a
   * monthly spend cap against invented numbers means the cap is not measuring spend, and
   * the ledger that accumulates those estimates is fiction that looks like accounting.
   *
   * That is the same failure as the `??` bug this check exists alongside, one level up: a
   * value that is *present but meaningless* passed silently as if it were real. The fix is
   * the same in shape — say so instead of guessing.
   *
   * Refusing costs the operator one two-line registry edit, once per model, and buys every
   * estimate afterwards being a real number. The escape hatch is the override that already
   * exists for the caps, so a person can still say "go anyway" and have that recorded.
   */
  if (input.rateKnown === false) {
    const model = input.model ? `"${input.model}"` : 'the requested model';
    const base = {
      scope: 'unpriced' as const,
      spentUsd: 0,
      capUsd: 0,
      remainingUsd: 0,
      projectedUsd: input.estimatedCostUsd,
    };
    if (input.override === true) {
      return {
        ...base,
        allowed: true,
        requiresOverride: true,
        reason: `No rate is configured for ${model}, so the cost of this run cannot be estimated. Dispatched anyway by explicit override; nothing was checked against the monthly cap.`,
      };
    }
    return {
      ...base,
      allowed: false,
      requiresOverride: true,
      reason: `No rate is configured for ${model}, so this run cannot be priced and the monthly cap cannot be enforced against it. Add a rate under \`agents.modelRates\` for this site — \`{ "${input.model ?? 'model-id'}": { "inputPerMillion": 0, "outputPerMillion": 0 } }\` — or dispatch with an explicit override.`,
    };
  }

  const siteCap = input.caps.perSiteMonthlyUsd[input.siteId];
  if (siteCap !== undefined) {
    const spent = spendInMonth(input.ledger, month, input.siteId, timeZone);
    const projected = round(spent + input.estimatedCostUsd);
    if (projected > siteCap) {
      return verdict('site', spent, siteCap, projected, input.override, input.siteId);
    }
  }

  const globalSpent = spendInMonth(input.ledger, month, undefined, timeZone);
  const globalProjected = round(globalSpent + input.estimatedCostUsd);
  if (globalProjected > input.caps.globalMonthlyUsd) {
    return verdict(
      'global',
      globalSpent,
      input.caps.globalMonthlyUsd,
      globalProjected,
      input.override,
      input.siteId,
    );
  }

  const spent =
    siteCap === undefined ? globalSpent : spendInMonth(input.ledger, month, input.siteId, timeZone);
  const cap = siteCap ?? input.caps.globalMonthlyUsd;
  return {
    allowed: true,
    requiresOverride: false,
    reason: `Within budget: ${format(spent)} of ${format(cap)} used this month.`,
    scope: 'none',
    spentUsd: spent,
    capUsd: cap,
    remainingUsd: round(Math.max(0, cap - spent)),
    projectedUsd: round(spent + input.estimatedCostUsd),
  };
}

function verdict(
  scope: 'site' | 'global',
  spent: number,
  cap: number,
  projected: number,
  override: boolean | undefined,
  siteId: string,
): DispatchVerdict {
  const subject = scope === 'site' ? `Site "${siteId}"` : 'The global budget';
  const base = {
    scope,
    spentUsd: spent,
    capUsd: cap,
    remainingUsd: round(Math.max(0, cap - spent)),
    projectedUsd: projected,
  };

  if (override === true) {
    return {
      ...base,
      allowed: true,
      requiresOverride: true,
      reason: `${subject} is at its monthly cap (${format(spent)} of ${format(cap)}). Dispatched anyway by explicit override; this run is projected to reach ${format(projected)}.`,
    };
  }

  return {
    ...base,
    allowed: false,
    requiresOverride: true,
    reason: `${subject} has reached its monthly cap: ${format(spent)} of ${format(cap)} used, and this run would take it to ${format(projected)}. Dispatch is blocked until the cap is raised or a person overrides it.`,
  };
}

/** Append a run's real cost to the ledger. Returns a new array; never mutates. */
export function recordRun(
  ledger: readonly CostLedgerEntry[],
  entry: CostLedgerEntry,
): CostLedgerEntry[] {
  // Idempotent on run id: a workflow that retries its bookkeeping step must not
  // double-count the run it already recorded.
  if (ledger.some((existing) => existing.runId === entry.runId)) return [...ledger];
  return [...ledger, entry];
}

export interface SpendSummary {
  readonly month: string;
  readonly globalSpentUsd: number;
  readonly globalCapUsd: number;
  readonly globalRemainingUsd: number;
  readonly perSite: ReadonlyArray<{
    readonly siteId: string;
    readonly spentUsd: number;
    readonly capUsd: number | null;
    readonly remainingUsd: number | null;
    readonly runs: number;
  }>;
}

/** What the admin's cost display reads. */
export function summariseSpend(
  ledger: readonly CostLedgerEntry[],
  caps: CostCaps,
  now: Date,
  timeZone = 'UTC',
): SpendSummary {
  const month = monthKey(now, timeZone);
  const inMonth = ledger.filter((entry) => monthKey(entry.at, timeZone) === month);
  const siteIds = [
    ...new Set([...inMonth.map((e) => e.siteId), ...Object.keys(caps.perSiteMonthlyUsd)]),
  ];

  const globalSpent = round(inMonth.reduce((total, entry) => total + entry.costUsd, 0));

  return {
    month,
    globalSpentUsd: globalSpent,
    globalCapUsd: caps.globalMonthlyUsd,
    globalRemainingUsd: round(Math.max(0, caps.globalMonthlyUsd - globalSpent)),
    perSite: siteIds.sort().map((siteId) => {
      const entries = inMonth.filter((entry) => entry.siteId === siteId);
      const spent = round(entries.reduce((total, entry) => total + entry.costUsd, 0));
      const cap = caps.perSiteMonthlyUsd[siteId] ?? null;
      return {
        siteId,
        spentUsd: spent,
        capUsd: cap,
        remainingUsd: cap === null ? null : round(Math.max(0, cap - spent)),
        runs: entries.length,
      };
    }),
  };
}

/** Cents, not floats: a running total of $0.000001 charges must not drift. */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function format(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}
