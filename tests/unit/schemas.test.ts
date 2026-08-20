import { describe, it, expect } from 'vitest';
import {
  postSchema,
  pageSchema,
  validateItem,
  missingRequiredFields,
  REQUIRED_ITEM_FIELDS,
  CONTENT_TYPES,
} from '@lib/schemas';
import { postInput, sampleProvenance, dhivehiPostInput } from '../fixtures/items';

/**
 * Schema failures are reported by field name because an editor reads them in the review
 * queue and has to know which box to fix. Every assertion below therefore checks the
 * `field`, not just that validation failed.
 */

const fieldNames = (input: unknown): string[] =>
  validateItem(postSchema, input).errors.map((error) => error.field);

describe('post schema — the eight required fields', () => {
  it('accepts a complete item', () => {
    const result = validateItem(postSchema, postInput());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(REQUIRED_ITEM_FIELDS)('names "%s" when it is missing', (field) => {
    const input: Record<string, unknown> = { ...postInput() };
    delete input[field];
    expect(fieldNames(input)).toContain(field);
  });

  it.each(REQUIRED_ITEM_FIELDS)('names "%s" when it is empty', (field) => {
    const input: Record<string, unknown> = { ...postInput(), [field]: '' };
    expect(fieldNames(input)).toContain(field);
  });

  it('reports every missing field at once rather than one per save', () => {
    const names = fieldNames({ title: 'Only a title' });
    for (const field of ['slug', 'category', 'publishedDate', 'excerpt', 'locale', 'author']) {
      expect(names).toContain(field);
    }
  });

  it('missingRequiredFields separates absence from invalidity', () => {
    expect(missingRequiredFields({ ...postInput(), category: undefined })).toEqual(['category']);
    // A present-but-wrong value is not "missing" — it needs a different fix.
    expect(missingRequiredFields({ ...postInput(), category: 'not-a-real-category' })).toEqual([]);
  });

  it('rejects a non-date publishedDate by name', () => {
    expect(fieldNames({ ...postInput(), publishedDate: 'not a date' })).toContain('publishedDate');
  });

  it('rejects an unknown locale by name', () => {
    expect(fieldNames({ ...postInput(), locale: 'fr' })).toContain('locale');
  });
});

describe('post schema — slug rules', () => {
  it.each([
    'Not A Slug',
    'trailing-',
    '-leading',
    'double--hyphen',
    'has_underscore',
    'ބަނދަރު',
    'percent%20encoded',
  ])('rejects %j', (slug) => {
    expect(fieldNames({ ...postInput(), slug })).toContain('slug');
  });

  it('accepts a transliterated Thaana slug', () => {
    expect(validateItem(postSchema, dhivehiPostInput()).errors).toEqual([]);
  });
});

describe('post schema — AI provenance', () => {
  it('refuses AI-authored content with no provenance, naming the field', () => {
    const errors = validateItem(postSchema, { ...postInput(), sourceType: 'ai' }).errors;
    expect(errors.map((e) => e.field)).toContain('provenance');
    expect(errors.find((e) => e.field === 'provenance')?.message).toMatch(
      /never be published as if a human wrote it/,
    );
  });

  it('refuses ai-assisted content with no provenance too', () => {
    expect(fieldNames({ ...postInput(), sourceType: 'ai-assisted' })).toContain('provenance');
  });

  it('accepts AI-authored content that carries provenance', () => {
    const result = validateItem(postSchema, {
      ...postInput(),
      sourceType: 'ai',
      provenance: sampleProvenance(),
    });
    expect(result.errors).toEqual([]);
  });

  it('requires every provenance source to carry a resolvable URL', () => {
    const errors = validateItem(postSchema, {
      ...postInput(),
      sourceType: 'ai',
      provenance: sampleProvenance({
        sources: [{ title: 'Somebody said so', url: 'not-a-url' }],
      }),
    }).errors;
    expect(errors.map((e) => e.field)).toContain('provenance.sources.0.url');
  });

  it('does not demand provenance for human-written content', () => {
    expect(validateItem(postSchema, postInput({ sourceType: 'human' })).errors).toEqual([]);
  });
});

describe('post schema — affiliate disclosure is enforced in the schema', () => {
  it('blocks an item carrying an affiliate offer with no disclosure', () => {
    const errors = validateItem(postSchema, {
      ...postInput(),
      affiliate: { hasOffers: true },
    }).errors;
    const disclosure = errors.find((e) => e.field === 'affiliate.disclosure');
    expect(disclosure).toBeDefined();
    expect(disclosure?.message).toMatch(/cannot publish without a disclosure/);
  });

  it('accepts it once the disclosure is materialised into frontmatter', () => {
    const result = validateItem(postSchema, {
      ...postInput(),
      affiliate: {
        hasOffers: true,
        disclosure: 'This article contains affiliate links.',
        network: 'example-network',
      },
    });
    expect(result.errors).toEqual([]);
  });

  it('does not require a disclosure when there is no offer', () => {
    expect(
      validateItem(postSchema, { ...postInput(), affiliate: { hasOffers: false } }).errors,
    ).toEqual([]);
  });

  it('defaults to no offers so existing content is unaffected', () => {
    const parsed = postSchema.parse(postInput());
    expect(parsed.affiliate.hasOffers).toBe(false);
  });
});

describe('post schema — cross-field invariants', () => {
  it('rejects an updatedDate before publishedDate', () => {
    expect(fieldNames({ ...postInput(), updatedDate: '2020-01-01T00:00:00.000Z' })).toContain(
      'updatedDate',
    );
  });

  it('rejects seriesIndex with no series', () => {
    expect(fieldNames({ ...postInput(), seriesIndex: 2 })).toContain('series');
  });

  it('rejects the scheduled state with no schedule', () => {
    expect(fieldNames({ ...postInput(), state: 'scheduled' })).toContain('schedule');
  });

  it('rejects a schedule that is both fixed and windowed', () => {
    const names = fieldNames({
      ...postInput(),
      state: 'scheduled',
      schedule: {
        at: '2026-04-01T08:00:00.000Z',
        window: { from: '08:00', to: '11:00', timezone: 'UTC', days: [] },
      },
    });
    expect(names.some((name) => name.startsWith('schedule'))).toBe(true);
  });

  it('rejects a malformed publish window time', () => {
    const names = fieldNames({
      ...postInput(),
      state: 'scheduled',
      schedule: { window: { from: '8am', to: '11:00', timezone: 'UTC', days: [] } },
    });
    expect(names.some((name) => name.includes('from'))).toBe(true);
  });
});

describe('defaults', () => {
  it('fills the fields the rest of the system reads without guarding', () => {
    const parsed = postSchema.parse(postInput());
    expect(parsed.draft).toBe(false);
    expect(parsed.featured).toBe(false);
    expect(parsed.pinned).toBe(false);
    expect(parsed.tags).toEqual([]);
    expect(parsed.transitions).toEqual([]);
    expect(parsed.state).toBe('draft');
    expect(parsed.approvalPolicy).toBe('human-required');
    expect(parsed.seo.noindex).toBe(false);
  });

  it('defaults the approval policy to the safe option', () => {
    // If this ever flips to `auto`, unreviewed agent output publishes itself.
    expect(postSchema.parse(postInput()).approvalPolicy).toBe('human-required');
  });
});

describe('page schema', () => {
  it('accepts a page and defaults its state', () => {
    const parsed = pageSchema.parse({ title: 'About', slug: 'about', locale: 'en' });
    expect(parsed.state).toBe('draft');
    expect(parsed.draft).toBe(false);
  });

  it('rejects a bad slug by name', () => {
    const result = validateItem(pageSchema, { title: 'About', slug: 'About Us', locale: 'en' });
    expect(result.errors.map((e) => e.field)).toContain('slug');
  });
});

describe('content type registry', () => {
  it('registers the six built-in types', () => {
    expect(Object.keys(CONTENT_TYPES).sort()).toEqual([
      'author',
      'category',
      'page',
      'post',
      'series',
      'tag',
    ]);
  });

  it('marks only posts as listed in feeds and archives', () => {
    const listed = Object.values(CONTENT_TYPES)
      .filter((type) => type.listed)
      .map((type) => type.id);
    expect(listed).toEqual(['post']);
  });

  it('marks posts and pages as moving through the editorial machine', () => {
    const editorial = Object.values(CONTENT_TYPES)
      .filter((type) => type.editorial)
      .map((type) => type.id);
    expect(editorial).toEqual(['post', 'page']);
  });
});
