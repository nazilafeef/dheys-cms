import { describe, it, expect } from 'vitest';
import {
  estimateCost,
  checkDispatch,
  recordRun,
  spendInMonth,
  summariseSpend,
  monthKey,
  format,
  DEFAULT_MODEL_RATES,
  type CostCaps,
  type CostLedgerEntry,
} from '@lib/cost';
import { envOr } from '@lib/runner-env';

const NOW = new Date('2026-06-10T09:00:00.000Z');

const caps: CostCaps = {
  globalMonthlyUsd: 40,
  perSiteMonthlyUsd: { 'example-news': 25, 'demo-journal': 10 },
};

function run(overrides: Partial<CostLedgerEntry> = {}): CostLedgerEntry {
  return {
    runId: 'run-1',
    siteId: 'example-news',
    model: 'claude-opus-5',
    provider: 'anthropic',
    tokensIn: 10_000,
    tokensOut: 2_000,
    costUsd: 1,
    at: NOW,
    ...overrides,
  };
}

describe('estimation', () => {
  it('prices a known model from the rate table', () => {
    // 1M in at $5 + 1M out at $25 = $30.
    const estimate = estimateCost({
      model: 'claude-opus-5',
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });
    expect(estimate.costUsd).toBe(30);
    expect(estimate.rateKnown).toBe(true);
  });

  it('scales linearly', () => {
    const estimate = estimateCost({ model: 'claude-opus-5', tokensIn: 100_000, tokensOut: 20_000 });
    expect(estimate.costUsd).toBeCloseTo(0.5 + 0.5, 6);
  });

  it('treats an unpriced model as expensive, not as free', () => {
    // The failure this prevents: a self-hosted model with no rate silently estimating $0
    // and slipping past every cap.
    const estimate = estimateCost({
      model: 'local-mixtral',
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      fallbackUsd: 2.5,
    });
    expect(estimate.rateKnown).toBe(false);
    expect(estimate.costUsd).toBe(2.5);
  });

  it('accepts a per-site rate override for a model this CMS does not ship', () => {
    const estimate = estimateCost({
      model: 'local-mixtral',
      tokensIn: 1_000_000,
      tokensOut: 0,
      rates: { 'local-mixtral': { inputPerMillion: 0.2, outputPerMillion: 0.4 } },
    });
    expect(estimate.rateKnown).toBe(true);
    expect(estimate.costUsd).toBeCloseTo(0.2, 6);
  });

  it('prices a shipped model when the site supplies an empty override table', () => {
    /*
     * The regression that mattered. `agents.modelRates` defaults to `{}` in the site
     * schema, so this is the shape almost every real site has. Under `input.rates ??
     * DEFAULT_MODEL_RATES` the empty object won, every model became unpriced, and every
     * job was estimated at its ceiling — which is what the monthly cap is enforced
     * against. Found on a live run, not in review.
     */
    const estimate = estimateCost({
      model: 'claude-opus-5',
      tokensIn: 1_000_000,
      tokensOut: 0,
      rates: {},
      fallbackUsd: 1,
    });
    expect(estimate.rateKnown).toBe(true);
    expect(estimate.costUsd).toBeCloseTo(5, 6);
  });

  it('lets a site override a rate this CMS ships, without losing the others', () => {
    const estimate = estimateCost({
      model: 'claude-opus-5',
      tokensIn: 1_000_000,
      tokensOut: 0,
      rates: { 'claude-opus-5': { inputPerMillion: 1, outputPerMillion: 2 } },
    });
    expect(estimate.rateKnown).toBe(true);
    expect(estimate.costUsd).toBeCloseTo(1, 6);

    // A model the override did not mention still prices from the shipped table.
    const other = estimateCost({
      model: 'claude-haiku-4-5',
      tokensIn: 1_000_000,
      tokensOut: 0,
      rates: { 'claude-opus-5': { inputPerMillion: 1, outputPerMillion: 2 } },
    });
    expect(other.rateKnown).toBe(true);
    expect(other.costUsd).toBeCloseTo(1, 6);
  });

  it('ships rates only for models it can actually price', () => {
    // Deliberately Anthropic-only; other providers' rates are the operator's to supply.
    expect(Object.keys(DEFAULT_MODEL_RATES).every((model) => model.startsWith('claude-'))).toBe(
      true,
    );
  });
});

describe('the ledger', () => {
  it('sums a month', () => {
    const ledger = [run({ runId: 'a', costUsd: 1 }), run({ runId: 'b', costUsd: 2.5 })];
    expect(spendInMonth(ledger, '2026-06')).toBe(3.5);
  });

  it('ignores other months', () => {
    const ledger = [
      run({ runId: 'a', costUsd: 1 }),
      run({ runId: 'b', costUsd: 99, at: new Date('2026-05-01T00:00:00.000Z') }),
    ];
    expect(spendInMonth(ledger, '2026-06')).toBe(1);
  });

  it('can be scoped to one site', () => {
    const ledger = [
      run({ runId: 'a', costUsd: 1, siteId: 'example-news' }),
      run({ runId: 'b', costUsd: 5, siteId: 'demo-journal' }),
    ];
    expect(spendInMonth(ledger, '2026-06', 'example-news')).toBe(1);
  });

  it('is idempotent on run id, so a retried bookkeeping step does not double-count', () => {
    const once = recordRun([], run({ runId: 'r1' }));
    const twice = recordRun(once, run({ runId: 'r1' }));
    expect(twice).toHaveLength(1);
  });

  it('never mutates the ledger it was given', () => {
    const original: CostLedgerEntry[] = [];
    recordRun(original, run());
    expect(original).toHaveLength(0);
  });

  it('keys months in the billing timezone, not blindly in UTC', () => {
    // 23:30 on 30 June UTC is already 1 July in the Maldives.
    const instant = new Date('2026-06-30T23:30:00.000Z');
    expect(monthKey(instant, 'UTC')).toBe('2026-06');
    expect(monthKey(instant, 'Indian/Maldives')).toBe('2026-07');
  });
});

describe('dispatch is checked before spending, not after', () => {
  it('allows a run comfortably inside the cap', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 5 })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresOverride).toBe(false);
    expect(verdict.remainingUsd).toBe(20);
  });

  it('blocks a run that would take a site past its cap', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24.5 })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.scope).toBe('site');
    expect(verdict.requiresOverride).toBe(true);
    expect(verdict.reason).toMatch(/reached its monthly cap/);
    expect(verdict.reason).toMatch(/Dispatch is blocked/);
  });

  it('blocks on the global cap even when the site has headroom', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [
        run({ runId: 'a', costUsd: 20, siteId: 'example-news' }),
        run({ runId: 'b', costUsd: 19.5, siteId: 'demo-journal' }),
      ],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.scope).toBe('global');
    expect(verdict.reason).toMatch(/global budget/);
  });

  it('checks the site cap first, so the message names the right budget', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24.9 })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.scope).toBe('site');
    expect(verdict.reason).toContain('example-news');
  });

  it('allows a blocked run only on an explicit override, and says it overrode', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24.5 })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
      override: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresOverride).toBe(true);
    expect(verdict.reason).toMatch(/Dispatched anyway by explicit override/);
  });

  it('never infers an override — anything but true blocks', () => {
    for (const override of [undefined, false]) {
      const verdict = checkDispatch({
        caps,
        ledger: [run({ costUsd: 24.5 })],
        siteId: 'example-news',
        estimatedCostUsd: 1,
        now: NOW,
        ...(override === undefined ? {} : { override }),
      });
      expect(verdict.allowed).toBe(false);
    }
  });

  it('blocks exactly at the boundary, not one run past it', () => {
    const atCap = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24 })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(atCap.allowed).toBe(true); // 24 + 1 = 25, exactly the cap

    const overCap = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24 })],
      siteId: 'example-news',
      estimatedCostUsd: 1.01,
      now: NOW,
    });
    expect(overCap.allowed).toBe(false);
  });

  it('bounds a site with no cap of its own by the global cap', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 39.5, siteId: 'sample-shop' })],
      siteId: 'sample-shop',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.scope).toBe('global');
  });

  it('ignores spend from a previous month', () => {
    const verdict = checkDispatch({
      caps,
      ledger: [run({ costUsd: 24.9, at: new Date('2026-05-10T00:00:00.000Z') })],
      siteId: 'example-news',
      estimatedCostUsd: 1,
      now: NOW,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('the admin cost display', () => {
  it('summarises global and per-site spend for the month', () => {
    const ledger = [
      run({ runId: 'a', costUsd: 3, siteId: 'example-news' }),
      run({ runId: 'b', costUsd: 2, siteId: 'demo-journal' }),
      run({
        runId: 'c',
        costUsd: 99,
        siteId: 'example-news',
        at: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ];
    const summary = summariseSpend(ledger, caps, NOW);

    expect(summary.month).toBe('2026-06');
    expect(summary.globalSpentUsd).toBe(5);
    expect(summary.globalRemainingUsd).toBe(35);

    const news = summary.perSite.find((site) => site.siteId === 'example-news');
    expect(news?.spentUsd).toBe(3);
    expect(news?.capUsd).toBe(25);
    expect(news?.remainingUsd).toBe(22);
    expect(news?.runs).toBe(1);
  });

  it('lists a capped site even before it has spent anything', () => {
    const summary = summariseSpend([], caps, NOW);
    expect(summary.perSite.map((site) => site.siteId).sort()).toEqual([
      'demo-journal',
      'example-news',
    ]);
  });

  it('reports a null cap for a site with none, rather than pretending it is zero', () => {
    const summary = summariseSpend([run({ siteId: 'sample-shop' })], caps, NOW);
    const shop = summary.perSite.find((site) => site.siteId === 'sample-shop');
    expect(shop?.capUsd).toBeNull();
    expect(shop?.remainingUsd).toBeNull();
  });
});

describe('formatting', () => {
  it('shows four decimals for sub-dollar amounts and two above', () => {
    expect(format(0.166)).toBe('$0.1660');
    expect(format(12.5)).toBe('$12.50');
  });
});

/**
 * The same defect, one level out.
 *
 * `estimateCost` priced every model at its ceiling because `??` cannot see the difference
 * between "absent" and "present but empty". Environment variables reach a runner the same
 * way: `${{ secrets.X }}` expands to the empty string when unset, not to nothing, so
 * `env['X'] ?? fallback` hands back `''` and the fallback never fires.
 */
describe('reading an environment value that may be present but empty', () => {
  it('uses the fallback when the variable is unset', () => {
    expect(envOr({}, 'MODEL', 'a-default')).toBe('a-default');
  });

  it('uses the fallback when the variable is an empty string', () => {
    // This is the case `??` gets wrong, and the case Actions actually produces.
    expect(envOr({ MODEL: '' }, 'MODEL', 'a-default')).toBe('a-default');
  });

  it('uses the value when one is genuinely set', () => {
    expect(envOr({ MODEL: 'chosen' }, 'MODEL', 'a-default')).toBe('chosen');
  });
});
