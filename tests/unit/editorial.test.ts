import { describe, it, expect } from 'vitest';
import {
  allowedNext,
  canTransition,
  isTerminal,
  transition,
  tryTransition,
  TransitionError,
  lastEntryInto,
  enteredCurrentStateAt,
  hasHumanApproval,
  contributors,
  describeHistory,
  ALL_STATES,
  type StatefulItem,
} from '@lib/editorial';
import type { Actor, EditorialState } from '@lib/schemas';

const HUMAN: Actor = { kind: 'human', id: 'example-editor' };
const AGENT: Actor = { kind: 'agent', id: 'run-2026-04-01-0042' };
const SYSTEM: Actor = { kind: 'system', id: 'scheduler' };

const AT = new Date('2026-04-01T10:00:00.000Z');

function item(state: EditorialState): StatefulItem {
  return { state, transitions: [] };
}

describe('the state machine', () => {
  it('follows the documented path from idea to published', () => {
    const path: EditorialState[] = [
      'commissioned',
      'researching',
      'drafting',
      'draft',
      'in-review',
      'approved',
      'scheduled',
      'published',
    ];

    let current = item('idea');
    for (const next of path) {
      current = transition(current, next, HUMAN, { at: AT });
    }
    expect(current.state).toBe('published');
    expect(current.transitions).toHaveLength(path.length);
  });

  it('routes changes-requested back into drafting', () => {
    const reviewing = item('in-review');
    const changed = transition(reviewing, 'changes-requested', HUMAN, {
      at: AT,
      note: 'Needs a source for the 1978 correction.',
    });
    expect(canTransition(changed.state, 'drafting')).toBe(true);
  });

  it('refuses a move that is not on the diagram, and says what is', () => {
    expect(() => transition(item('draft'), 'published', HUMAN, { at: AT })).toThrow(
      TransitionError,
    );
    expect(() => transition(item('draft'), 'published', HUMAN, { at: AT })).toThrow(
      /the only permitted next states are: in-review, drafting, rejected/,
    );
  });

  it('treats published and rejected as terminal', () => {
    expect(isTerminal('published')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(allowedNext('published')).toEqual([]);
    expect(() => transition(item('published'), 'draft', HUMAN, { at: AT })).toThrow(
      /terminal state/,
    );
  });

  it('lets an operator unschedule back to approved without losing the approval', () => {
    expect(canTransition('scheduled', 'approved')).toBe(true);
    expect(canTransition('scheduled', 'draft')).toBe(false);
  });

  it('allows rejection from every non-terminal state', () => {
    for (const state of ALL_STATES) {
      if (isTerminal(state)) continue;
      expect(canTransition(state, 'rejected'), `${state} -> rejected`).toBe(true);
    }
  });

  it('never mutates the item it was given', () => {
    const original = item('draft');
    transition(original, 'in-review', HUMAN, { at: AT });
    expect(original.state).toBe('draft');
    expect(original.transitions).toEqual([]);
  });

  it('reports rather than throws when asked to', () => {
    const result = tryTransition(item('draft'), 'published', HUMAN, { at: AT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cannot move from "draft"/);
  });
});

describe('the audit trail', () => {
  it('records the actor and the instant on every transition', () => {
    const moved = transition(item('draft'), 'in-review', HUMAN, { at: AT });
    const record = moved.transitions[0];
    expect(record?.from).toBe('draft');
    expect(record?.to).toBe('in-review');
    expect(record?.at).toEqual(AT);
    expect(record?.actor).toEqual(HUMAN);
  });

  it('keeps a note when one is given, and omits the key when not', () => {
    const withNote = transition(item('in-review'), 'changes-requested', HUMAN, {
      at: AT,
      note: 'Tighten the opening.',
    });
    expect(withNote.transitions[0]?.note).toBe('Tighten the opening.');

    const without = transition(item('draft'), 'in-review', HUMAN, { at: AT });
    expect(without.transitions[0]).not.toHaveProperty('note');
  });

  it('finds the last entry into a state', () => {
    let current = item('draft');
    current = transition(current, 'in-review', HUMAN, { at: AT });
    current = transition(current, 'changes-requested', HUMAN, {
      at: new Date('2026-04-02T10:00:00.000Z'),
    });
    current = transition(current, 'drafting', AGENT, { at: new Date('2026-04-03T10:00:00.000Z') });
    current = transition(current, 'draft', AGENT, { at: new Date('2026-04-04T10:00:00.000Z') });
    current = transition(current, 'in-review', HUMAN, { at: new Date('2026-04-05T10:00:00.000Z') });

    expect(lastEntryInto(current, 'in-review')?.at).toEqual(new Date('2026-04-05T10:00:00.000Z'));
    expect(enteredCurrentStateAt(current)).toEqual(new Date('2026-04-05T10:00:00.000Z'));
  });

  it('lists every actor once, in first-seen order', () => {
    let current = item('drafting');
    current = transition(current, 'draft', AGENT, { at: AT });
    current = transition(current, 'in-review', HUMAN, { at: AT });
    current = transition(current, 'approved', HUMAN, { at: AT });
    expect(contributors(current)).toEqual([AGENT, HUMAN]);
  });

  it('renders a readable history', () => {
    const moved = transition(item('draft'), 'in-review', HUMAN, { at: AT, note: 'Ready.' });
    expect(describeHistory(moved)[0]).toBe(
      '2026-04-01T10:00:00.000Z  draft → in-review  by human:example-editor — Ready.',
    );
  });
});

describe('human approval', () => {
  it('is true only when a person approved it', () => {
    const byHuman = transition(item('in-review'), 'approved', HUMAN, { at: AT });
    expect(hasHumanApproval(byHuman)).toBe(true);
  });

  it('is false when an agent approved it', () => {
    const byAgent = transition(item('in-review'), 'approved', AGENT, { at: AT });
    expect(hasHumanApproval(byAgent)).toBe(false);
  });

  it('is false when the scheduler approved it on a lapsed deadline', () => {
    // This is the load-bearing case: `human-required` must not be satisfied by the
    // system auto-approving an item whose review window ran out.
    const bySystem = transition(item('in-review'), 'approved', SYSTEM, { at: AT });
    expect(hasHumanApproval(bySystem)).toBe(false);
  });

  it('is false for an item nobody has approved', () => {
    expect(hasHumanApproval(item('in-review'))).toBe(false);
  });
});
