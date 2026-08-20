import {
  EDITORIAL_STATES,
  type Actor,
  type EditorialState,
  type Transition,
} from './schemas';

/**
 * The editorial state machine.
 *
 *   idea → commissioned → researching → drafting → draft
 *        → in-review → approved → scheduled → published
 *                    → changes-requested → drafting
 *                    → rejected
 *
 * The machine is the only thing permitted to change an item's state. Every accepted
 * transition appends a record naming the actor -- a GitHub login for a person, a run id
 * for an agent -- and the instant it happened. Those records live in the item's
 * frontmatter, so the git history of the site repository *is* the audit trail: who
 * moved what, when, and on whose authority, recoverable from a clone with no database
 * and no service to query.
 */

/** Allowed destinations for each state. Anything not listed here is refused. */
const ALLOWED: Readonly<Record<EditorialState, readonly EditorialState[]>> = Object.freeze({
  idea: ['commissioned', 'drafting', 'rejected'],
  commissioned: ['researching', 'drafting', 'rejected'],
  researching: ['drafting', 'rejected'],
  drafting: ['draft', 'rejected'],
  draft: ['in-review', 'drafting', 'rejected'],
  'in-review': ['approved', 'changes-requested', 'rejected'],
  'changes-requested': ['drafting', 'rejected'],
  approved: ['scheduled', 'published', 'rejected'],
  // Unscheduling returns an item to `approved` rather than dropping it to draft, so an
  // operator who changes their mind about timing does not lose the approval.
  scheduled: ['published', 'approved', 'rejected'],
  published: [],
  rejected: [],
});

/** States from which nothing further can happen. */
export const TERMINAL_STATES: readonly EditorialState[] = ['published', 'rejected'];

/** States in which an item is a candidate for automated publishing. */
export const PUBLISHABLE_FROM: readonly EditorialState[] = ['approved', 'scheduled'];

export function allowedNext(from: EditorialState): readonly EditorialState[] {
  return ALLOWED[from];
}

export function canTransition(from: EditorialState, to: EditorialState): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminal(state: EditorialState): boolean {
  return TERMINAL_STATES.includes(state);
}

export class TransitionError extends Error {
  readonly from: EditorialState;
  readonly to: EditorialState;

  constructor(from: EditorialState, to: EditorialState) {
    const options = ALLOWED[from];
    const detail =
      options.length === 0
        ? `"${from}" is a terminal state — nothing follows it`
        : `from "${from}" the only permitted next states are: ${options.join(', ')}`;
    super(`Cannot move from "${from}" to "${to}": ${detail}.`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

/** The subset of an item this module reads and writes. */
export interface StatefulItem {
  state: EditorialState;
  transitions: Transition[];
}

export interface TransitionOptions {
  readonly note?: string;
  /** Injected rather than read from the clock so tests and runners are deterministic. */
  readonly at: Date;
}

/**
 * Apply a transition, returning a new item. Never mutates its input: an item that fails
 * validation downstream must leave no trace of a half-applied state change.
 *
 * @throws {TransitionError} when the move is not permitted.
 */
export function transition<T extends StatefulItem>(
  item: T,
  to: EditorialState,
  actor: Actor,
  options: TransitionOptions,
): T {
  const from = item.state;
  if (!canTransition(from, to)) throw new TransitionError(from, to);

  const record: Transition = {
    from,
    to,
    at: options.at,
    actor,
    ...(options.note === undefined ? {} : { note: options.note }),
  };

  return { ...item, state: to, transitions: [...item.transitions, record] };
}

/** Non-throwing form, for callers that report rather than fail. */
export function tryTransition<T extends StatefulItem>(
  item: T,
  to: EditorialState,
  actor: Actor,
  options: TransitionOptions,
): { ok: true; item: T } | { ok: false; error: string } {
  try {
    return { ok: true, item: transition(item, to, actor, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Reading the audit trail
 * ------------------------------------------------------------------ */

/** The most recent transition into `state`, if the item ever entered it. */
export function lastEntryInto(
  item: StatefulItem,
  state: EditorialState,
): Transition | undefined {
  for (let index = item.transitions.length - 1; index >= 0; index -= 1) {
    const record = item.transitions[index];
    if (record?.to === state) return record;
  }
  return undefined;
}

/** When the item entered its current state. */
export function enteredCurrentStateAt(item: StatefulItem): Date | undefined {
  return lastEntryInto(item, item.state)?.at;
}

/**
 * Whether a person -- as opposed to an agent or the scheduler -- approved this item.
 * The `human-required` policy and the human-review guardrail both hinge on this, so it
 * deliberately does not count a system actor that moved the item on a deadline.
 */
export function hasHumanApproval(item: StatefulItem): boolean {
  return item.transitions.some((record) => record.to === 'approved' && record.actor.kind === 'human');
}

/** Every actor that has touched the item, in first-seen order. */
export function contributors(item: StatefulItem): Actor[] {
  const seen = new Set<string>();
  const list: Actor[] = [];
  for (const record of item.transitions) {
    const key = `${record.actor.kind}:${record.actor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(record.actor);
  }
  return list;
}

/** Human-readable trail for the admin's history panel. */
export function describeHistory(item: StatefulItem): string[] {
  return item.transitions.map((record) => {
    const from = record.from ?? '(new)';
    const note = record.note ? ` — ${record.note}` : '';
    return `${record.at.toISOString()}  ${from} → ${record.to}  by ${record.actor.kind}:${record.actor.id}${note}`;
  });
}

/** All states, for building filters and pickers without hardcoding the list. */
export const ALL_STATES: readonly EditorialState[] = EDITORIAL_STATES;
