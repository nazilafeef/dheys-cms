import { postSchema, type Post } from '@lib/schemas';
import type { ProjectableItem } from '@lib/content-adapters';

/**
 * Fixtures.
 *
 * Every site named here is invented — `example-news`, `demo-journal`, `sample-shop` — and
 * every URL is an RFC 2606 reserved domain. The clean-room gate scans this file like any
 * other, which is the point: fixtures are the easiest place for a real site to leak in.
 */

/**
 * Unvalidated frontmatter, which is what these fixtures actually are: the shape an item
 * has when it arrives from an agent or off disk, *before* the schema has seen it.
 *
 * Typing this as `z.input<typeof postSchema>` would be wrong twice over. `z.coerce.date()`
 * reports its static input as `Date` even though it accepts an ISO string at runtime, so
 * every fixture would have to construct `new Date(...)` for no benefit; and several tests
 * deliberately pass invalid or missing fields to prove the schema names them.
 */
export type RawItem = Record<string, unknown>;

/** A minimal item that passes the schema, for tests that only care about one field. */
export function postInput(overrides: RawItem = {}): RawItem {
  return {
    title: 'The tide gauge at the old harbour',
    slug: 'the-tide-gauge-at-the-old-harbour',
    category: 'environment',
    publishedDate: '2026-03-04T09:00:00.000Z',
    excerpt: 'A century of readings, and what they say about the next one.',
    locale: 'en',
    author: 'A. Editor',
    sourceType: 'human',
    ...overrides,
  };
}

/** Parse-or-throw, so a broken fixture fails loudly rather than skewing a test. */
export function makePost(overrides: RawItem = {}): Post {
  const parsed = postSchema.safeParse(postInput(overrides));
  if (!parsed.success) {
    throw new Error(
      `Fixture does not satisfy postSchema: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export const SAMPLE_BODY = [
  'The gauge was installed in 1912 and has been read, by hand, almost every day since.',
  '',
  'What the record shows is not dramatic. It is a slow, patient line, and its patience is',
  'the part that matters.',
].join('\n');

export function projectable(overrides: RawItem = {}, body = SAMPLE_BODY): ProjectableItem {
  return { item: makePost(overrides), body };
}

/** Provenance block for an AI-authored item, with invented but structurally real values. */
export function sampleProvenance(overrides: RawItem = {}): RawItem {
  return {
    model: 'claude-opus-5',
    provider: 'anthropic',
    promptVersion: 'news-brief@3',
    runId: 'run-2026-03-04-0007',
    jobType: 'write',
    sources: [
      {
        title: 'Harbour authority annual report 2025',
        url: 'https://example-news.example.com/reports/2025',
        accessedAt: '2026-03-03T22:10:00.000Z',
      },
    ],
    tokensIn: 18_420,
    tokensOut: 2_980,
    costUsd: 0.166,
    startedAt: '2026-03-04T06:12:00.000Z',
    completedAt: '2026-03-04T06:13:41.000Z',
    ...overrides,
  };
}

/** A Dhivehi item, used wherever Thaana handling has to be exercised for real. */
export function dhivehiPostInput(overrides: RawItem = {}): RawItem {
  return postInput({
    title: 'ބަނދަރުގެ ދިޔަވަރު މާޕު',
    slug: 'bandharuge-dhiyavaru-maapu',
    excerpt: 'ސަތޭކަ އަހަރުގެ ރެކޯޑް، އަދި އެއިން ދޭހަވާ އެއްޗެއް.',
    locale: 'dv',
    category: 'thimaaveshi',
    author: 'އެޑިޓަރު',
    ...overrides,
  });
}
