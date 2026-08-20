import { describe, it, expect } from 'vitest';
import {
  tick,
  isDue,
  resolvePublishAt,
  seededUnitRandom,
  windowSeed,
  zonedTimeToUtc,
  zonedDateParts,
  planDrip,
  type QueueEntry,
  type TickInput,
} from '@lib/scheduler';
import { transition } from '@lib/editorial';
import { makePost } from '../fixtures/items';
import type { Actor } from '@lib/schemas';

const HUMAN: Actor = { kind: 'human', id: 'example-editor' };
const NOW = new Date('2026-06-10T09:00:00.000Z');

function entry(
  overrides: Record<string, unknown> = {},
  options: Partial<QueueEntry> = {},
): QueueEntry {
  const item = makePost({ slug: 'an-article', ...overrides });
  return {
    id: `example-news/en/${item.slug}`,
    siteId: 'example-news',
    item,
    body: 'Prose.',
    guardrailsPassed: true,
    ...options,
  };
}

function input(entries: QueueEntry[], overrides: Partial<TickInput> = {}): TickInput {
  return {
    now: NOW,
    entries,
    killSwitch: false,
    publishedLedger: [],
    defaultTimezone: 'UTC',
    ...overrides,
  };
}

/** An item a person has explicitly approved. */
function approved(overrides: Record<string, unknown> = {}): QueueEntry {
  const base = makePost({ slug: 'an-article', state: 'in-review', ...overrides });
  const item = transition(base, 'approved', HUMAN, { at: new Date('2026-06-01T00:00:00.000Z') });
  return {
    id: `example-news/en/${item.slug}`,
    siteId: 'example-news',
    item,
    body: 'Prose.',
    guardrailsPassed: true,
  };
}

describe('due-ness', () => {
  it('is at-or-after, never exactly-on — cron runners are not punctual', () => {
    const due = new Date('2026-06-10T09:00:00.000Z');
    expect(isDue(due, due)).toBe(true);
    expect(isDue(new Date('2026-06-10T09:00:01.000Z'), due)).toBe(true);
    expect(isDue(new Date('2026-06-10T08:59:59.000Z'), due)).toBe(false);
  });

  it('holds an item that is not due yet, and says when it will be', () => {
    const result = tick(input([approved({ publishedDate: '2026-12-01T00:00:00.000Z' })]));
    expect(result.decisions[0]?.action).toBe('hold');
    expect(result.decisions[0]?.reason).toContain('Not due until 2026-12-01');
    expect(result.toPublish).toEqual([]);
  });
});

describe('missed windows are caught up, never skipped', () => {
  it('publishes an item whose slot passed hours ago, flagged as late', () => {
    const result = tick(input([approved({ publishedDate: '2026-06-10T05:00:00.000Z' })]));
    const decision = result.decisions[0];

    expect(decision?.action).toBe('publish');
    expect(decision?.late).toBe(true);
    expect(decision?.lateBySeconds).toBe(4 * 60 * 60);
    expect(decision?.reason).toMatch(/4h late \(missed window caught up\)/);
  });

  it('publishes an item late by days rather than dropping it', () => {
    const result = tick(input([approved({ publishedDate: '2026-05-01T00:00:00.000Z' })]));
    expect(result.decisions[0]?.action).toBe('publish');
    expect(result.decisions[0]?.late).toBe(true);
  });

  it('does not flag an on-time publish as late', () => {
    const result = tick(input([approved({ publishedDate: '2026-06-10T09:00:00.000Z' })]));
    expect(result.decisions[0]?.late).toBe(false);
    expect(result.decisions[0]?.reason).toMatch(/publishing now/);
  });

  it('reports the late catch-ups in the summary', () => {
    const result = tick(input([approved({ publishedDate: '2026-06-01T00:00:00.000Z' })]));
    expect(result.summary).toContain('late catch-up: 1');
  });
});

describe('idempotency', () => {
  it('skips an item already in the ledger', () => {
    const queued = approved({ publishedDate: '2026-06-01T00:00:00.000Z' });
    const result = tick(input([queued], { publishedLedger: [queued.id] }));

    expect(result.decisions[0]?.action).toBe('already-published');
    expect(result.toPublish).toEqual([]);
  });

  it('skips an item whose own state says it is published', () => {
    // Built with `entry`, not `approved`: `published` is terminal, so the state machine
    // correctly refuses to transition into `approved` from it.
    const queued = entry({ state: 'published', publishedDate: '2026-06-01T00:00:00.000Z' });
    const result = tick(input([queued]));
    expect(result.decisions[0]?.action).toBe('already-published');
  });

  it('produces identical decisions when run twice over the same inputs', () => {
    const entries = [
      approved({ slug: 'one', publishedDate: '2026-06-01T00:00:00.000Z' }),
      approved({ slug: 'two', publishedDate: '2026-12-01T00:00:00.000Z' }),
    ];
    const first = tick(input(entries));
    const second = tick(input(entries));
    expect(second.decisions).toEqual(first.decisions);
  });

  it('does not publish twice when the first run is recorded between ticks', () => {
    const queued = approved({ publishedDate: '2026-06-01T00:00:00.000Z' });

    const first = tick(input([queued]));
    expect(first.toPublish).toHaveLength(1);

    // The runner commits, then records the id. The next tick must not re-publish.
    const second = tick(input([queued], { publishedLedger: first.toPublish.map((d) => d.id) }));
    expect(second.toPublish).toEqual([]);
    expect(second.decisions[0]?.action).toBe('already-published');
  });
});

describe('approval policy', () => {
  it('publishes `auto` without any human step', () => {
    const result = tick(
      input([entry({ approvalPolicy: 'auto', publishedDate: '2026-06-01T00:00:00.000Z' })]),
    );
    expect(result.decisions[0]?.action).toBe('publish');
  });

  it('holds `human-required` until a person approves', () => {
    const result = tick(
      input([
        entry({ approvalPolicy: 'human-required', publishedDate: '2026-06-01T00:00:00.000Z' }),
      ]),
    );
    expect(result.decisions[0]?.action).toBe('awaiting-approval');
    expect(result.decisions[0]?.reason).toMatch(/no person has approved it/);
  });

  it('publishes `human-required` once a person has approved', () => {
    const result = tick(input([approved({ publishedDate: '2026-06-01T00:00:00.000Z' })]));
    expect(result.decisions[0]?.action).toBe('publish');
  });

  it('auto-publishes `human-optional` when the review deadline lapses', () => {
    const result = tick(
      input([
        entry({
          approvalPolicy: 'human-optional',
          state: 'in-review',
          publishedDate: '2026-06-01T00:00:00.000Z',
          schedule: { reviewDeadline: '2026-06-09T00:00:00.000Z' },
        }),
      ]),
    );

    const decision = result.decisions[0];
    expect(decision?.action).toBe('publish');
    expect(decision?.autoApproved).toBe(true);
    expect(decision?.reason).toMatch(/lapsed with no decision/);
  });

  it('waits while a `human-optional` deadline is still open', () => {
    const result = tick(
      input([
        entry({
          approvalPolicy: 'human-optional',
          state: 'in-review',
          publishedDate: '2026-06-01T00:00:00.000Z',
          schedule: { reviewDeadline: '2026-12-01T00:00:00.000Z' },
        }),
      ]),
    );
    expect(result.decisions[0]?.action).toBe('awaiting-approval');
    expect(result.decisions[0]?.autoApproved).toBeUndefined();
  });

  it('never auto-publishes `human-optional` with no deadline set', () => {
    const result = tick(
      input([
        entry({
          approvalPolicy: 'human-optional',
          state: 'in-review',
          publishedDate: '2026-06-01T00:00:00.000Z',
        }),
      ]),
    );
    expect(result.decisions[0]?.action).toBe('awaiting-approval');
    expect(result.decisions[0]?.reason).toMatch(/no review deadline was set/);
  });

  it('respects a human decision against, even after the deadline', () => {
    const result = tick(
      input([
        entry({
          approvalPolicy: 'human-optional',
          state: 'changes-requested',
          publishedDate: '2026-06-01T00:00:00.000Z',
          schedule: { reviewDeadline: '2026-06-01T00:00:00.000Z' },
        }),
      ]),
    );
    expect(result.decisions[0]?.action).toBe('blocked');
    expect(result.decisions[0]?.reason).toMatch(/decided against it/);
  });
});

describe('guardrails and the kill switch', () => {
  it('blocks an item that failed its guardrails, and repeats the reason', () => {
    const result = tick(
      input([
        {
          ...approved({ publishedDate: '2026-06-01T00:00:00.000Z' }),
          guardrailsPassed: false,
          guardrailMessages: ['Example News: "An article" needs the affiliate disclosure.'],
        },
      ]),
    );
    expect(result.decisions[0]?.action).toBe('blocked');
    expect(result.decisions[0]?.reason).toMatch(/affiliate disclosure/);
  });

  it('halts everything when the kill switch is on', () => {
    const result = tick(
      input([approved({ publishedDate: '2026-06-01T00:00:00.000Z' })], { killSwitch: true }),
    );
    expect(result.decisions[0]?.action).toBe('halted');
    expect(result.toPublish).toEqual([]);
    expect(result.summary).toContain('KILL SWITCH ON');
  });

  it('checks guardrails before the kill switch, so the log shows what is held back', () => {
    const result = tick(
      input(
        [
          {
            ...approved({ publishedDate: '2026-06-01T00:00:00.000Z' }),
            guardrailsPassed: false,
            guardrailMessages: ['blocked for a reason'],
          },
        ],
        { killSwitch: true },
      ),
    );
    // Blocked, not halted: the operator needs to know this one has a second problem.
    expect(result.decisions[0]?.action).toBe('blocked');
  });

  it('never reconsiders a rejected item', () => {
    const result = tick(
      input([entry({ state: 'rejected', publishedDate: '2026-06-01T00:00:00.000Z' })]),
    );
    expect(result.decisions[0]?.action).toBe('blocked');
    expect(result.decisions[0]?.reason).toMatch(/was rejected/);
  });
});

describe('embargo', () => {
  it('pushes publication later, even for an approved item', () => {
    const due = resolvePublishAt(
      {
        slug: 'x',
        publishedDate: new Date('2026-06-01T00:00:00.000Z'),
        schedule: { embargoUntil: new Date('2026-08-01T00:00:00.000Z') },
      },
      { siteId: 's', slug: 'x', defaultTimezone: 'UTC' },
    );
    expect(due.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('never pulls publication earlier', () => {
    const due = resolvePublishAt(
      {
        slug: 'x',
        publishedDate: new Date('2026-06-01T00:00:00.000Z'),
        schedule: { embargoUntil: new Date('2026-01-01T00:00:00.000Z') },
      },
      { siteId: 's', slug: 'x', defaultTimezone: 'UTC' },
    );
    expect(due.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('seeded randomisation', () => {
  it('is deterministic for a given seed', () => {
    const seed = windowSeed('example-news', 'an-article', '2026-06-11');
    expect(seededUnitRandom(seed)).toBe(seededUnitRandom(seed));
  });

  it('differs across items, days and sites', () => {
    const a = seededUnitRandom(windowSeed('example-news', 'one', '2026-06-11'));
    const b = seededUnitRandom(windowSeed('example-news', 'two', '2026-06-11'));
    const c = seededUnitRandom(windowSeed('example-news', 'one', '2026-06-12'));
    const d = seededUnitRandom(windowSeed('demo-journal', 'one', '2026-06-11'));
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('stays inside [0, 1)', () => {
    for (let index = 0; index < 500; index += 1) {
      const value = seededUnitRandom(`seed-${index}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('resolves a windowed publish time to the same instant every call', () => {
    const options = { siteId: 'example-news', slug: 'an-article', defaultTimezone: 'UTC' };
    const item = {
      slug: 'an-article',
      publishedDate: new Date('2026-06-11T00:00:00.000Z'),
      schedule: {
        window: {
          from: '08:00',
          to: '11:00',
          timezone: 'Indian/Maldives',
          days: [],
        },
      },
    };

    const first = resolvePublishAt(item, options);
    const second = resolvePublishAt(item, options);
    expect(second.toISOString()).toBe(first.toISOString());
  });

  it('lands inside the requested window, in the window timezone', () => {
    const due = resolvePublishAt(
      {
        slug: 'an-article',
        publishedDate: new Date('2026-06-11T00:00:00.000Z'),
        schedule: {
          window: { from: '08:00', to: '11:00', timezone: 'Indian/Maldives', days: [] },
        },
      },
      { siteId: 'example-news', slug: 'an-article', defaultTimezone: 'UTC' },
    );

    // Indian/Maldives is UTC+5, so 08:00-11:00 local is 03:00-06:00 UTC.
    const hour = due.getUTCHours();
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThan(6);
  });

  it('honours the days restriction — "Thursday only" means Thursday', () => {
    // 2026-06-11 is a Thursday; ask for Thursdays only starting from a Monday.
    const due = resolvePublishAt(
      {
        slug: 'an-article',
        publishedDate: new Date('2026-06-08T00:00:00.000Z'),
        schedule: {
          window: { from: '08:00', to: '11:00', timezone: 'UTC', days: [4] },
        },
      },
      { siteId: 'example-news', slug: 'an-article', defaultTimezone: 'UTC' },
    );
    expect(zonedDateParts(due, 'UTC').weekday).toBe(4);
  });

  it('falls back to the item date rather than swallowing content on a bad days list', () => {
    const due = resolvePublishAt(
      {
        slug: 'x',
        publishedDate: new Date('2026-06-08T00:00:00.000Z'),
        // A weekday number that never occurs.
        schedule: { window: { from: '08:00', to: '11:00', timezone: 'UTC', days: [9] } },
      },
      { siteId: 's', slug: 'x', defaultTimezone: 'UTC' },
    );
    expect(due.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });
});

describe('time zones', () => {
  it('converts a wall-clock time in a zone to the right UTC instant', () => {
    // Indian/Maldives is UTC+5 year-round.
    expect(zonedTimeToUtc(2026, 6, 11, 8, 30, 'Indian/Maldives').toISOString()).toBe(
      '2026-06-11T03:30:00.000Z',
    );
  });

  it('handles a zone that observes daylight saving', () => {
    // Europe/London is UTC+1 in June, UTC+0 in January.
    expect(zonedTimeToUtc(2026, 6, 11, 12, 0, 'Europe/London').toISOString()).toBe(
      '2026-06-11T11:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 1, 11, 12, 0, 'Europe/London').toISOString()).toBe(
      '2026-01-11T12:00:00.000Z',
    );
  });

  it('reads the calendar date in the target zone, not in UTC', () => {
    // 22:00 UTC on the 10th is already the 11th in the Maldives.
    const parts = zonedDateParts(new Date('2026-06-10T22:00:00.000Z'), 'Indian/Maldives');
    expect(parts.day).toBe(11);
  });
});

describe('drip scheduling', () => {
  it('spreads items across eligible days at the requested rate', () => {
    const plan = planDrip(['a', 'b', 'c', 'd'], {
      start: new Date('2026-06-08T00:00:00.000Z'),
      end: new Date('2026-06-20T00:00:00.000Z'),
      perDay: 2,
      window: { from: '08:00', to: '11:00', timezone: 'UTC', days: [] },
      siteId: 'example-news',
      defaultTimezone: 'UTC',
    });

    expect(plan).toHaveLength(4);
    const days = plan.map((date) => date.toISOString().slice(0, 10));
    expect(new Set(days).size).toBe(2);
  });

  it('stops at the end of the range rather than overrunning it', () => {
    const plan = planDrip(['a', 'b', 'c', 'd', 'e'], {
      start: new Date('2026-06-08T00:00:00.000Z'),
      end: new Date('2026-06-09T00:00:00.000Z'),
      perDay: 1,
      window: { from: '08:00', to: '11:00', timezone: 'UTC', days: [] },
      siteId: 'example-news',
      defaultTimezone: 'UTC',
    });
    expect(plan.length).toBeLessThanOrEqual(2);
  });
});

describe('the tick summary', () => {
  it('counts every outcome', () => {
    const result = tick(
      input([
        approved({ slug: 'due', publishedDate: '2026-06-01T00:00:00.000Z' }),
        approved({ slug: 'later', publishedDate: '2026-12-01T00:00:00.000Z' }),
        entry({ slug: 'unapproved', publishedDate: '2026-06-01T00:00:00.000Z' }),
      ]),
    );
    expect(result.summary).toContain('publish: 1');
    expect(result.summary).toContain('hold: 1');
    expect(result.summary).toContain('awaiting-approval: 1');
  });

  it('says so plainly when the queue is empty', () => {
    expect(tick(input([])).summary).toBe('nothing queued');
  });

  it('gives every entry exactly one decision', () => {
    const entries = [
      approved({ slug: 'a', publishedDate: '2026-06-01T00:00:00.000Z' }),
      approved({ slug: 'b', publishedDate: '2026-12-01T00:00:00.000Z' }),
      entry({ slug: 'c' }),
    ];
    expect(tick(input(entries)).decisions).toHaveLength(entries.length);
  });
});
