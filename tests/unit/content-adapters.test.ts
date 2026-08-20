import { describe, it, expect } from 'vitest';
import { project, publishableItems, toRecord } from '@lib/content-adapters';
import { parseDocument } from '@lib/frontmatter';
import { postSchema } from '@lib/schemas';
import { projectable, SAMPLE_BODY, sampleProvenance } from '../fixtures/items';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const options = { now: NOW };

describe('draft and future-dated exclusion', () => {
  it('withholds drafts', () => {
    const items = [
      projectable({ slug: 'published-one' }),
      projectable({ slug: 'a-draft', draft: true }),
    ];
    expect(publishableItems(items, options).map((entry) => entry.item.slug)).toEqual([
      'published-one',
    ]);
  });

  it('withholds future-dated items, which is what makes scheduling mean anything', () => {
    const items = [
      projectable({ slug: 'already-out', publishedDate: '2026-01-01T00:00:00.000Z' }),
      projectable({ slug: 'not-yet', publishedDate: '2026-12-25T00:00:00.000Z' }),
    ];
    expect(publishableItems(items, options).map((entry) => entry.item.slug)).toEqual([
      'already-out',
    ]);
  });

  it('withholds rejected items', () => {
    const items = [projectable({ slug: 'rejected-one', state: 'rejected' })];
    expect(publishableItems(items, options)).toEqual([]);
  });

  it('includes drafts only when a preview build asks for them', () => {
    const items = [projectable({ slug: 'a-draft', draft: true })];
    expect(publishableItems(items, { now: NOW, includeDrafts: true })).toHaveLength(1);
  });

  it('says how many items it withheld rather than dropping them silently', () => {
    const result = project(
      { kind: 'json', outputPath: 'src/data/posts.json', includeBody: true },
      [projectable({ slug: 'ok' }), projectable({ slug: 'draft-one', draft: true })],
      options,
    );
    expect(result.notes.join(' ')).toMatch(/1 item\(s\) withheld/);
  });
});

describe('collections adapter', () => {
  const config = { kind: 'collections', directory: 'src/content/posts', extension: 'md' } as const;

  it('writes one Markdown file per item, under its locale', () => {
    const result = project(
      config,
      [
        projectable({ slug: 'first', locale: 'en' }),
        projectable({
          slug: 'thaana',
          locale: 'dv',
          title: 'ދިޔަވަރު',
          category: 'thimaaveshi',
          author: 'އެޑިޓަރު',
          excerpt: 'ކުރު ޚުލާޞާ',
        }),
      ],
      options,
    );
    expect(result.files.map((file) => file.path)).toEqual([
      'src/content/posts/en/first.md',
      'src/content/posts/dv/thaana.md',
    ]);
  });

  it('emits output the target can read straight back through its own schema', () => {
    const result = project(config, [projectable({ slug: 'first' })], options);
    const file = result.files[0];
    expect(file).toBeDefined();
    const parsed = parseDocument(file?.contents ?? '');
    expect(parsed.hadFrontmatter).toBe(true);
    // The real assertion: the projected file validates against the same schema the CMS
    // used to produce it. A projection that cannot be re-read is not a projection.
    const revalidated = postSchema.safeParse(parsed.data);
    expect(revalidated.success).toBe(true);
    expect(parsed.body.trim()).toBe(SAMPLE_BODY.trim());
  });

  it('runs no transform at all — the target already speaks this format', () => {
    expect(project(config, [projectable()], options).commands).toEqual([]);
  });

  it('honours the mdx extension', () => {
    const result = project({ ...config, extension: 'mdx' }, [projectable({ slug: 'x' })], options);
    expect(result.files[0]?.path.endsWith('.mdx')).toBe(true);
  });
});

describe('json adapter', () => {
  const config = { kind: 'json', outputPath: 'src/data/posts.json', includeBody: true } as const;

  it('emits ONE complete, parseable JSON document containing a top-level array', () => {
    const result = project(
      config,
      [projectable({ slug: 'one' }), projectable({ slug: 'two' })],
      options,
    );
    expect(result.files).toHaveLength(1);
    const contents = result.files[0]?.contents ?? '';

    // This is the property that matters: a consumer doing
    //   import posts from './posts.json' with { type: 'json' }
    // must get an array. A brace-less fragment fails here.
    const parsed: unknown = JSON.parse(contents);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(2);
    expect(contents.trimStart().startsWith('[')).toBe(true);
    expect(contents.trimEnd().endsWith(']')).toBe(true);
  });

  it('emits a valid empty array when there is nothing to publish', () => {
    const result = project(config, [], options);
    const parsed: unknown = JSON.parse(result.files[0]?.contents ?? '');
    expect(parsed).toEqual([]);
  });

  it('carries dates as ISO strings, since JSON has no date type', () => {
    const result = project(config, [projectable({ slug: 'one' })], options);
    const [record] = JSON.parse(result.files[0]?.contents ?? '') as Array<Record<string, unknown>>;
    expect(record?.['publishedDate']).toBe('2026-03-04T09:00:00.000Z');
  });

  it('omits the body when the site does not want it', () => {
    const result = project({ ...config, includeBody: false }, [projectable()], options);
    const [record] = JSON.parse(result.files[0]?.contents ?? '') as Array<Record<string, unknown>>;
    expect(record).not.toHaveProperty('body');
  });
});

describe('js-module adapter', () => {
  const config = {
    kind: 'js-module',
    outputPath: 'src/data/guides.js',
    exportName: 'guides',
  } as const;

  it('emits a module with a named and a default export', () => {
    const contents =
      project(config, [projectable({ slug: 'one' })], options).files[0]?.contents ?? '';
    expect(contents).toContain('export const guides = [');
    expect(contents).toContain('export default guides;');
  });

  it('emits an array literal that parses as JSON once the wrapper is removed', () => {
    const contents =
      project(config, [projectable({ slug: 'one' })], options).files[0]?.contents ?? '';
    const start = contents.indexOf('[');
    const end = contents.lastIndexOf(']');
    const parsed: unknown = JSON.parse(contents.slice(start, end + 1));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('warns the reader not to hand-edit generated output', () => {
    const contents = project(config, [projectable()], options).files[0]?.contents ?? '';
    expect(contents).toMatch(/Generated by Dheys CMS/);
  });
});

describe('generic adapter', () => {
  it('writes Markdown and hands back the transform command for the runner', () => {
    const result = project(
      { kind: 'generic', directory: 'content', transformCommand: 'npm run build:content' },
      [projectable({ slug: 'one' })],
      options,
    );
    expect(result.files[0]?.path).toBe('content/en/one.md');
    expect(result.commands).toEqual(['npm run build:content']);
  });

  it('says plainly when no transform is configured', () => {
    const result = project({ kind: 'generic', directory: 'content' }, [projectable()], options);
    expect(result.commands).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/nothing else runs/);
  });
});

describe('record projection', () => {
  it('renders an attribution line for AI-authored content', () => {
    const entry = projectable({ sourceType: 'ai', provenance: sampleProvenance() });
    expect(toRecord(entry, { includeBody: false }).attribution).toBe('Written by claude-opus-5');
  });

  it('names the reviewer once a person has signed off', () => {
    const entry = projectable({
      sourceType: 'ai',
      provenance: sampleProvenance({ reviewedBy: 'example-editor' }),
    });
    expect(toRecord(entry, { includeBody: false }).attribution).toBe(
      'Written by claude-opus-5, reviewed by example-editor',
    );
  });

  it('renders no attribution for human-written content', () => {
    expect(toRecord(projectable(), { includeBody: false }).attribution).toBeUndefined();
  });

  it('carries the affiliate disclosure through to the target', () => {
    const entry = projectable({
      affiliate: { hasOffers: true, disclosure: 'Contains affiliate links.' },
    });
    expect(toRecord(entry, { includeBody: false }).affiliateDisclosure).toBe(
      'Contains affiliate links.',
    );
  });
});
