import type { Post, Schedule, PublishWindow } from './schemas';
import { hasHumanApproval } from './editorial';

/**
 * The scheduler.
 *
 * This runs as a cron GitHub Action. Cron runners are *not* punctual: under load GitHub
 * delays scheduled workflows, sometimes by many minutes, and occasionally drops a tick
 * entirely. Three consequences shape everything here:
 *
 *  1. Nothing may assume exact-minute firing. "Due" means `dueAt <= now`, never
 *     `dueAt === now`.
 *  2. A missed window is published *late*, not skipped. An item whose slot passed four
 *     hours ago still goes out, flagged as late, because silently dropping an item an
 *     operator scheduled is the worse failure.
 *  3. Every tick is idempotent. The same inputs produce the same decisions, and an item
 *     already published is skipped rather than published again -- a double-publish
 *     means a duplicate commit, a duplicate deploy and, for a news site, a duplicate
 *     entry in every feed reader that already saw it.
 *
 * `tick` is pure: it takes the queue and a clock and returns decisions. The runner in
 * .github/workflows/scheduler.yml is the only thing that acts on them.
 */

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */

/** xmur3 string hash — turns a seed string into a 32-bit state. */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 — small, fast, and identical on every platform. */
function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A number in [0, 1) derived only from `seed`.
 *
 * Randomised publish times must be reproducible: a scheduler that re-rolls the offset
 * on every tick would move an item's slot every five minutes and could publish it
 * hours from where the operator saw it in the calendar. Seeding from the item's
 * identity and target day means the calendar, the tick and the test all agree.
 */
export function seededUnitRandom(seed: string): number {
  return mulberry32(xmur3(seed)())();
}

/** The seed for one item's window on one day. Stable across ticks and processes. */
export function windowSeed(siteId: string, slug: string, dayIso: string): string {
  return `${siteId}:${slug}:${dayIso}`;
}

/* ------------------------------------------------------------------ *
 * Time zones
 * ------------------------------------------------------------------ */

/** Offset, in ms, between the given instant's wall time in `timeZone` and UTC. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant.
 * Resolved twice so a time that falls across a DST change lands on the correct offset.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const secondPass = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** Calendar date, in `timeZone`, of an instant. */
export function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts['weekday'] ?? 'Sun',
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    weekday: weekdayIndex < 0 ? 0 : weekdayIndex,
  };
}

function parseHhMm(value: string): { hour: number; minute: number } {
  const [hourText = '0', minuteText = '0'] = value.split(':');
  return { hour: Number(hourText), minute: Number(minuteText) };
}

/* ------------------------------------------------------------------ *
 * Resolving a publish instant
 * ------------------------------------------------------------------ */

export interface ResolveOptions {
  readonly siteId: string;
  readonly slug: string;
  readonly defaultTimezone: string;
}

/**
 * Pick the instant an item is meant to go out.
 *
 * Precedence: an explicit `schedule.at` wins; otherwise a `schedule.window` produces a
 * seeded time on the first eligible day on or after `publishedDate`; otherwise
 * `publishedDate` itself. An embargo can only ever push the result later.
 */
export function resolvePublishAt(
  item: Pick<Post, 'publishedDate' | 'schedule' | 'slug'>,
  options: ResolveOptions,
): Date {
  const schedule: Schedule | undefined = item.schedule;
  let resolved: Date;

  if (schedule?.at) {
    resolved = schedule.at;
  } else if (schedule?.window) {
    resolved = resolveWindow(item.publishedDate, schedule.window, options);
  } else {
    resolved = item.publishedDate;
  }

  if (schedule?.embargoUntil && schedule.embargoUntil > resolved) {
    return schedule.embargoUntil;
  }
  return resolved;
}

/** First eligible day on or after `from`, then a seeded minute inside the window. */
function resolveWindow(from: Date, window: PublishWindow, options: ResolveOptions): Date {
  const timeZone = window.timezone || options.defaultTimezone;
  const start = parseHhMm(window.from);
  const end = parseHhMm(window.to);

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  // A window that wraps midnight ("22:00 to 02:00") is treated as ending at midnight
  // rather than silently producing a negative span.
  const span = Math.max(1, endMinutes - startMinutes);

  let cursor = new Date(from.getTime());
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const parts = zonedDateParts(cursor, timeZone);
    const eligible = window.days.length === 0 || window.days.includes(parts.weekday);
    if (eligible) {
      const dayIso = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
      const unit = seededUnitRandom(windowSeed(options.siteId, options.slug, dayIso));
      const offset = Math.floor(unit * span);
      const candidate = zonedTimeToUtc(
        parts.year,
        parts.month,
        parts.day,
        start.hour,
        start.minute + offset,
        timeZone,
      );
      // Only accept a slot that is not already behind the item's own date.
      if (candidate >= from || attempt > 0) return candidate;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  // No eligible day inside two weeks — fall back to the item's date rather than never
  // publishing it. A misconfigured `days` list must not swallow content.
  return from;
}

/* ------------------------------------------------------------------ *
 * The tick
 * ------------------------------------------------------------------ */

export interface QueueEntry {
  /** Stable identity: `${siteId}/${locale}/${slug}`. Used for the idempotency ledger. */
  readonly id: string;
  readonly siteId: string;
  readonly item: Post;
  readonly body: string;
  /** Guardrail verdict, computed by the caller so this module stays pure. */
  readonly guardrailsPassed: boolean;
  readonly guardrailMessages?: readonly string[];
}

export type DecisionAction =
  'publish' | 'hold' | 'blocked' | 'already-published' | 'halted' | 'awaiting-approval';

export interface Decision {
  readonly id: string;
  readonly siteId: string;
  readonly action: DecisionAction;
  readonly dueAt: Date;
  /** True when the slot passed before this tick ran — a catch-up, not a skip. */
  readonly late: boolean;
  readonly lateBySeconds: number;
  /** One line, safe to print in a workflow log. */
  readonly reason: string;
  /** Set when the deadline lapsed and the item is being approved by the system. */
  readonly autoApproved?: boolean;
}

export interface TickInput {
  readonly now: Date;
  readonly entries: readonly QueueEntry[];
  /** Repository variable. When true, nothing publishes anywhere, without a redeploy. */
  readonly killSwitch: boolean;
  /** Ids already committed by a previous tick. */
  readonly publishedLedger: readonly string[];
  readonly defaultTimezone: string;
}

export interface TickResult {
  readonly decisions: readonly Decision[];
  readonly toPublish: readonly Decision[];
  readonly summary: string;
}

/**
 * Decide what to do with every queued item. Pure and total: every entry gets exactly one
 * decision, and running it twice over the same inputs yields the same decisions.
 */
export function tick(input: TickInput): TickResult {
  const ledger = new Set(input.publishedLedger);
  const decisions: Decision[] = [];

  for (const entry of input.entries) {
    const dueAt = resolvePublishAt(entry.item, {
      siteId: entry.siteId,
      slug: entry.item.slug,
      defaultTimezone: input.defaultTimezone,
    });
    const lateBySeconds = Math.max(0, Math.floor((input.now.getTime() - dueAt.getTime()) / 1000));
    const late = lateBySeconds > 0;

    const base = { id: entry.id, siteId: entry.siteId, dueAt, late, lateBySeconds };

    // Idempotency first: an item already out is never reconsidered, whatever else is
    // true of it.
    if (ledger.has(entry.id) || entry.item.state === 'published') {
      decisions.push({
        ...base,
        action: 'already-published',
        reason: 'Already published — skipped.',
      });
      continue;
    }

    if (entry.item.state === 'rejected') {
      decisions.push({ ...base, action: 'blocked', reason: 'Item was rejected.' });
      continue;
    }

    if (!isDue(input.now, dueAt)) {
      decisions.push({
        ...base,
        action: 'hold',
        reason: `Not due until ${dueAt.toISOString()}.`,
      });
      continue;
    }

    const approval = approvalDecision(entry, input.now);
    if (approval.action !== 'publish') {
      decisions.push({ ...base, ...approval });
      continue;
    }

    // Guardrails apply to every route to publication, including `auto`.
    if (!entry.guardrailsPassed) {
      const detail = entry.guardrailMessages?.length ? ` ${entry.guardrailMessages.join(' ')}` : '';
      decisions.push({ ...base, action: 'blocked', reason: `Blocked by guardrails.${detail}` });
      continue;
    }

    // The kill switch is checked last so the log still records *why* an item would have
    // published. An operator who flips the switch needs to see what it is holding back.
    if (input.killSwitch) {
      decisions.push({
        ...base,
        action: 'halted',
        reason: 'Publishing kill switch is on — no item publishes on any site.',
      });
      continue;
    }

    decisions.push({
      ...base,
      action: 'publish',
      reason: late
        ? `Due ${dueAt.toISOString()}, publishing ${formatLateness(lateBySeconds)} late (missed window caught up).`
        : `Due ${dueAt.toISOString()}, publishing now.`,
      ...(approval.autoApproved ? { autoApproved: true } : {}),
    });
  }

  const toPublish = decisions.filter((decision) => decision.action === 'publish');
  return { decisions, toPublish, summary: summarise(decisions, input.killSwitch) };
}

/** Due means at or after the instant — never exactly on it. */
export function isDue(now: Date, dueAt: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}

function approvalDecision(
  entry: QueueEntry,
  now: Date,
): { action: DecisionAction; reason: string; autoApproved?: boolean } {
  const { item } = entry;

  switch (item.approvalPolicy) {
    case 'auto':
      return { action: 'publish', reason: 'Approval policy is auto.' };

    case 'human-required': {
      if (hasHumanApproval(item)) return { action: 'publish', reason: 'Approved by a person.' };
      return {
        action: 'awaiting-approval',
        reason: 'Approval policy is human-required and no person has approved it.',
      };
    }

    case 'human-optional': {
      if (hasHumanApproval(item)) return { action: 'publish', reason: 'Approved by a person.' };
      if (item.state === 'rejected' || item.state === 'changes-requested') {
        return { action: 'blocked', reason: 'A person decided against it.' };
      }
      const deadline = item.schedule?.reviewDeadline;
      if (!deadline) {
        return {
          action: 'awaiting-approval',
          reason: 'Approval policy is human-optional but no review deadline was set.',
        };
      }
      if (now.getTime() >= deadline.getTime()) {
        return {
          action: 'publish',
          reason: `Review deadline ${deadline.toISOString()} lapsed with no decision — auto-publishing.`,
          autoApproved: true,
        };
      }
      return {
        action: 'awaiting-approval',
        reason: `Waiting for a decision until ${deadline.toISOString()}.`,
      };
    }
  }
}

function formatLateness(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function summarise(decisions: readonly Decision[], killSwitch: boolean): string {
  const counts = new Map<DecisionAction, number>();
  for (const decision of decisions) {
    counts.set(decision.action, (counts.get(decision.action) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([action, count]) => `${action}: ${count}`);
  const lateCount = decisions.filter((d) => d.action === 'publish' && d.late).length;
  if (lateCount > 0) parts.push(`late catch-up: ${lateCount}`);
  if (killSwitch) parts.unshift('KILL SWITCH ON');
  return parts.join(', ') || 'nothing queued';
}

/* ------------------------------------------------------------------ *
 * Drip scheduling
 * ------------------------------------------------------------------ */

export interface DripOptions {
  readonly start: Date;
  readonly end: Date;
  readonly perDay: number;
  readonly window: PublishWindow;
  readonly siteId: string;
  readonly defaultTimezone: string;
}

/**
 * Spread items across a date range, `perDay` per eligible day, each at a seeded time
 * inside the window. Returns one instant per item, in order.
 */
export function planDrip(slugs: readonly string[], options: DripOptions): Date[] {
  const timeZone = options.window.timezone || options.defaultTimezone;
  const plan: Date[] = [];
  let cursor = new Date(options.start.getTime());
  let index = 0;

  while (index < slugs.length && cursor <= options.end) {
    const parts = zonedDateParts(cursor, timeZone);
    const eligible =
      options.window.days.length === 0 || options.window.days.includes(parts.weekday);
    if (eligible) {
      for (let n = 0; n < options.perDay && index < slugs.length; n += 1) {
        const slug = slugs[index];
        if (slug === undefined) break;
        plan.push(
          resolvePublishAt(
            {
              slug,
              publishedDate: cursor,
              schedule: { window: options.window },
            },
            { siteId: options.siteId, slug, defaultTimezone: options.defaultTimezone },
          ),
        );
        index += 1;
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return plan;
}
