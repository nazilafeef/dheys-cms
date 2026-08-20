import { describe, it, expect } from 'vitest';
import {
  intake,
  attributionLine,
  agentJobRequestSchema,
  JOB_TYPES,
  CONTRACT_REQUIRED_FIELDS,
} from '@lib/job-contract';
import { REQUIRED_ITEM_FIELDS } from '@lib/schemas';
import { postInput, sampleProvenance } from '../fixtures/items';

/**
 * The agent job contract.
 *
 * The two fields agents most reliably drop in the real world are `category` and
 * `publishedDate`: a model asked for "an article about X" returns prose, a title and
 * usually an excerpt, and silently omits the taxonomy and the date. This suite exists to
 * prove that lands as a named-field rejection at intake rather than as a broken site build
 * three hours later.
 */

const usage = {
  tokensIn: 18_420,
  tokensOut: 2_980,
  costUsd: 0.166,
  model: 'claude-opus-5',
  provider: 'anthropic',
};

function jobResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run-2026-04-01-0042',
    jobType: 'write',
    status: 'completed',
    item: postInput({ sourceType: 'human' }),
    body: 'Some prose.',
    usage,
    startedAt: '2026-04-01T22:12:00.000Z',
    completedAt: '2026-04-01T22:13:41.000Z',
    promptVersion: 'news-brief@3',
    sources: [],
    ...overrides,
  };
}

describe('the contract itself', () => {
  it('names exactly the eight required fields, and agrees with the schema', () => {
    expect(CONTRACT_REQUIRED_FIELDS).toEqual(REQUIRED_ITEM_FIELDS);
    expect(CONTRACT_REQUIRED_FIELDS).toHaveLength(8);
  });

  it('declares the seven job types', () => {
    expect([...JOB_TYPES].sort()).toEqual([
      'fact-check',
      'image-alt',
      'research',
      'rewrite',
      'seo-optimise',
      'translate',
      'write',
    ]);
  });

  it('requires a dispatch request to carry a cost ceiling', () => {
    const result = agentJobRequestSchema.safeParse({
      runId: 'r1',
      jobType: 'write',
      siteId: 'example-news',
      locale: 'en',
      brief: 'Write about tides.',
      promptVersion: 'v1',
    });
    expect(result.success).toBe(false);
  });
});

describe('intake accepts good output', () => {
  it('accepts a complete item and returns it parsed', () => {
    const outcome = intake(jobResult());
    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
      expect(outcome.item.title).toBe('The tide gauge at the old harbour');
      expect(outcome.body).toBe('Some prose.');
      expect(outcome.runId).toBe('run-2026-04-01-0042');
    }
  });
});

describe('intake rejects items missing a required field, by name', () => {
  it.each(REQUIRED_ITEM_FIELDS)('rejects an item with no %s', (field) => {
    const item: Record<string, unknown> = { ...postInput() };
    delete item[field];

    const outcome = intake(jobResult({ item }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.missingFields).toContain(field);
      expect(outcome.errors.map((error) => error.field)).toContain(field);
      expect(outcome.summary).toContain(field);
    }
  });

  it('calls out a missing category specifically, since that is the common failure', () => {
    const item: Record<string, unknown> = { ...postInput() };
    delete item['category'];

    const outcome = intake(jobResult({ item }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.summary).toMatch(/missing category/);
      expect(outcome.summary).toMatch(/Required fields are/);
    }
  });

  it('calls out a missing publishedDate specifically', () => {
    const item: Record<string, unknown> = { ...postInput() };
    delete item['publishedDate'];

    const outcome = intake(jobResult({ item }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.summary).toMatch(/missing publishedDate/);
  });

  it('reports both when both are missing', () => {
    const item: Record<string, unknown> = { ...postInput() };
    delete item['category'];
    delete item['publishedDate'];

    const outcome = intake(jobResult({ item }));
    if (!outcome.accepted) {
      expect(outcome.missingFields).toEqual(expect.arrayContaining(['category', 'publishedDate']));
    }
  });

  it('separates "absent" from "present but invalid"', () => {
    const outcome = intake(jobResult({ item: postInput({ publishedDate: 'not a date' }) }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      // Present but wrong: it is an error, but not a *missing* field. The fix differs.
      expect(outcome.missingFields).not.toContain('publishedDate');
      expect(outcome.errors.map((error) => error.field)).toContain('publishedDate');
    }
  });

  it('rejects a completed job that carries no item at all', () => {
    const outcome = intake(jobResult({ item: undefined }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.errors[0]?.field).toBe('item');
      expect(outcome.missingFields).toEqual([...REQUIRED_ITEM_FIELDS]);
    }
  });
});

describe('intake handles provider failure', () => {
  it('reports a failed job with the provider reason', () => {
    const outcome = intake(
      jobResult({ status: 'failed', error: 'rate limited after 3 attempts', item: undefined }),
    );
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.summary).toMatch(/failed at the provider: rate limited/);
    }
  });

  it('says so plainly when a provider fails with no reason', () => {
    const outcome = intake(jobResult({ status: 'failed', item: undefined }));
    if (!outcome.accepted) expect(outcome.summary).toMatch(/no reason given/);
  });

  it('survives a completely malformed payload without throwing', () => {
    const outcome = intake({ nonsense: true });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.runId).toBe('(unknown run)');
  });

  it('recovers the run id from a malformed payload when it is there', () => {
    const outcome = intake({ runId: 'run-9', jobType: 'nope' });
    if (!outcome.accepted) expect(outcome.runId).toBe('run-9');
  });
});

describe('provenance is built from the run, not from the model', () => {
  it('attaches provenance to AI-authored output automatically', () => {
    const outcome = intake(
      jobResult({
        item: postInput({ sourceType: 'ai' }),
        sources: [{ title: 'A report', url: 'https://example-news.example.com/reports/2025' }],
      }),
    );

    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
      expect(outcome.item.provenance?.runId).toBe('run-2026-04-01-0042');
      expect(outcome.item.provenance?.model).toBe('claude-opus-5');
      expect(outcome.item.provenance?.costUsd).toBe(0.166);
      expect(outcome.item.provenance?.sources).toHaveLength(1);
    }
  });

  it('ignores provenance the model tried to report for itself', () => {
    // An agent claiming it cost nothing must not be believed.
    const outcome = intake(
      jobResult({
        item: {
          ...postInput({ sourceType: 'ai' }),
          provenance: sampleProvenance({ costUsd: 0, runId: 'made-up', model: 'something-else' }),
        },
      }),
    );

    expect(outcome.accepted).toBe(true);
    if (outcome.accepted) {
      expect(outcome.item.provenance?.costUsd).toBe(0.166);
      expect(outcome.item.provenance?.runId).toBe('run-2026-04-01-0042');
      expect(outcome.item.provenance?.model).toBe('claude-opus-5');
    }
  });

  it('rejects AI-authored output when the run reported no usage to build provenance from', () => {
    const outcome = intake(jobResult({ item: postInput({ sourceType: 'ai' }), usage: undefined }));
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.errors.map((error) => error.field)).toContain('provenance');
    }
  });

  it('leaves human-authored output without provenance', () => {
    const outcome = intake(jobResult());
    if (outcome.accepted) expect(outcome.item.provenance).toBeUndefined();
  });
});

describe('attribution', () => {
  it('names the model for unreviewed AI content', () => {
    const outcome = intake(jobResult({ item: postInput({ sourceType: 'ai' }) }));
    if (outcome.accepted) {
      expect(attributionLine(outcome.item)).toBe('Written by claude-opus-5');
    }
  });

  it('names the reviewer once a person has signed off', () => {
    const outcome = intake(
      jobResult({ item: { ...postInput({ sourceType: 'ai' }), reviewedBy: 'example-editor' } }),
    );
    if (outcome.accepted) {
      expect(attributionLine(outcome.item)).toBe(
        'Written by claude-opus-5, reviewed by example-editor',
      );
    }
  });

  it('produces no line for human-written content', () => {
    const outcome = intake(jobResult());
    if (outcome.accepted) expect(attributionLine(outcome.item)).toBeUndefined();
  });
});
