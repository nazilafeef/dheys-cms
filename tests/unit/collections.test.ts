import { describe, it, expect } from 'vitest';
import {
  visiblePosts,
  sortForListing,
  byCategory,
  byTag,
  byAuthor,
  categoryCounts,
  tagCounts,
  readingTimeMinutes,
  relatedPosts,
  neighbours,
  seriesOrder,
  tableOfContents,
  headingSlug,
  paginate,
} from '@lib/collections';
import { projectable, SAMPLE_BODY } from '../fixtures/items';

const NOW = new Date('2026-07-01T00:00:00.000Z');

describe('visibility', () => {
  it('excludes drafts and future-dated posts from a public build', () => {
    const posts = [
      projectable({ slug: 'live', publishedDate: '2026-01-01T00:00:00.000Z' }),
      projectable({ slug: 'draft-one', draft: true }),
      projectable({ slug: 'future', publishedDate: '2027-01-01T00:00:00.000Z' }),
      projectable({ slug: 'rejected-one', state: 'rejected' }),
    ];
    expect(visiblePosts(posts, { now: NOW }).map((p) => p.item.slug)).toEqual(['live']);
  });

  it('still renders a noindex post — that flag is about crawlers, not visibility', () => {
    const posts = [
      projectable({
        slug: 'unlisted',
        seo: { noindex: true },
        publishedDate: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(visiblePosts(posts, { now: NOW })).toHaveLength(1);
  });

  it('lets a preview build opt into drafts', () => {
    const posts = [projectable({ slug: 'draft-one', draft: true })];
    expect(visiblePosts(posts, { now: NOW, includeDrafts: true })).toHaveLength(1);
  });
});

describe('listing order', () => {
  it('is newest first', () => {
    const posts = [
      projectable({ slug: 'older', publishedDate: '2026-01-01T00:00:00.000Z' }),
      projectable({ slug: 'newer', publishedDate: '2026-05-01T00:00:00.000Z' }),
    ];
    expect(sortForListing(posts).map((p) => p.item.slug)).toEqual(['newer', 'older']);
  });

  it('holds pinned posts at the top, in their own date order', () => {
    const posts = [
      projectable({ slug: 'newest', publishedDate: '2026-06-01T00:00:00.000Z' }),
      projectable({ slug: 'pinned-old', publishedDate: '2026-01-01T00:00:00.000Z', pinned: true }),
      projectable({ slug: 'pinned-new', publishedDate: '2026-02-01T00:00:00.000Z', pinned: true }),
    ];
    expect(sortForListing(posts).map((p) => p.item.slug)).toEqual([
      'pinned-new',
      'pinned-old',
      'newest',
    ]);
  });

  it('does not mutate its input', () => {
    const posts = [
      projectable({ slug: 'a', publishedDate: '2026-01-01T00:00:00.000Z' }),
      projectable({ slug: 'b', publishedDate: '2026-05-01T00:00:00.000Z' }),
    ];
    const before = posts.map((p) => p.item.slug);
    sortForListing(posts);
    expect(posts.map((p) => p.item.slug)).toEqual(before);
  });
});

describe('filters and counts', () => {
  const posts = [
    projectable({ slug: 'a', category: 'environment', tags: ['tides'], author: 'A. Editor' }),
    projectable({
      slug: 'b',
      category: 'environment',
      tags: ['tides', 'weather'],
      author: 'B. Writer',
    }),
    projectable({ slug: 'c', category: 'media', tags: ['ai'], author: 'A. Editor' }),
  ];

  it('filters by category, tag and author', () => {
    expect(byCategory(posts, 'environment')).toHaveLength(2);
    expect(byTag(posts, 'tides')).toHaveLength(2);
    expect(byAuthor(posts, 'A. Editor')).toHaveLength(2);
  });

  it('counts categories, most used first', () => {
    expect(categoryCounts(posts)).toEqual([
      { name: 'environment', count: 2 },
      { name: 'media', count: 1 },
    ]);
  });

  it('counts tags across posts', () => {
    expect(tagCounts(posts)).toEqual([
      { name: 'tides', count: 2 },
      { name: 'ai', count: 1 },
      { name: 'weather', count: 1 },
    ]);
  });
});

describe('reading time', () => {
  it('is never zero, even for a one-word post', () => {
    expect(readingTimeMinutes('Hello.', 'en')).toBe(1);
  });

  it('ignores code blocks, which nobody reads at prose speed', () => {
    const prose = 'word '.repeat(220);
    const withCode = `${prose}\n\n\`\`\`js\n${'x '.repeat(2000)}\n\`\`\`\n`;
    expect(readingTimeMinutes(withCode, 'en')).toBe(readingTimeMinutes(prose, 'en'));
  });

  it('reads Thaana more slowly than Latin, because readers do', () => {
    const latin = 'word '.repeat(400);
    const thaana = 'ދިވެހި '.repeat(400);
    expect(readingTimeMinutes(thaana, 'dv')).toBeGreaterThan(readingTimeMinutes(latin, 'en'));
  });

  it('counts Thaana words at all', () => {
    expect(readingTimeMinutes('ދިވެހި '.repeat(300), 'dv')).toBeGreaterThan(1);
  });
});

describe('related posts', () => {
  const target = projectable({
    slug: 'target',
    category: 'environment',
    tags: ['tides', 'archives'],
    series: 'notebooks',
  });

  it('ranks a shared series above a shared category', () => {
    const candidates = [
      projectable({ slug: 'same-category', category: 'environment', tags: [] }),
      projectable({ slug: 'same-series', category: 'media', tags: [], series: 'notebooks' }),
    ];
    expect(relatedPosts(target, candidates, 2)[0]?.item.slug).toBe('same-series');
  });

  it('ranks shared tags above nothing', () => {
    const candidates = [
      projectable({ slug: 'unrelated', category: 'media', tags: ['cooking'] }),
      projectable({ slug: 'shares-tags', category: 'media', tags: ['tides', 'archives'] }),
    ];
    const related = relatedPosts(target, candidates, 3);
    expect(related.map((p) => p.item.slug)).toEqual(['shares-tags']);
  });

  it('never suggests the post itself', () => {
    expect(relatedPosts(target, [target], 3)).toEqual([]);
  });

  it('never suggests a post in another language', () => {
    const other = projectable({
      slug: 'dv-one',
      locale: 'dv',
      category: 'environment',
      title: 'ދިޔަވަރު',
      author: 'އެޑިޓަރު',
      excerpt: 'ކުރު',
    });
    expect(relatedPosts(target, [other], 3)).toEqual([]);
  });

  it('honours the limit', () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      projectable({ slug: `c${index}`, category: 'environment', tags: [] }),
    );
    expect(relatedPosts(target, candidates, 3)).toHaveLength(3);
  });
});

describe('neighbours', () => {
  const posts = [
    projectable({ slug: 'oldest', publishedDate: '2026-01-01T00:00:00.000Z' }),
    projectable({ slug: 'middle', publishedDate: '2026-03-01T00:00:00.000Z' }),
    projectable({ slug: 'newest', publishedDate: '2026-05-01T00:00:00.000Z' }),
  ];

  it('treats "previous" as the older post', () => {
    const { previous, next } = neighbours(posts, 'middle');
    expect(previous?.item.slug).toBe('oldest');
    expect(next?.item.slug).toBe('newest');
  });

  it('has no previous at the oldest end and no next at the newest', () => {
    expect(neighbours(posts, 'oldest').previous).toBeUndefined();
    expect(neighbours(posts, 'newest').next).toBeUndefined();
  });

  it('returns nothing for a slug that is not in the list', () => {
    expect(neighbours(posts, 'missing')).toEqual({ previous: undefined, next: undefined });
  });
});

describe('series order', () => {
  it('orders by seriesIndex, not by date', () => {
    const posts = [
      projectable({
        slug: 'part-two',
        series: 's',
        seriesIndex: 2,
        publishedDate: '2026-01-01T00:00:00.000Z',
      }),
      projectable({
        slug: 'part-one',
        series: 's',
        seriesIndex: 1,
        publishedDate: '2026-05-01T00:00:00.000Z',
      }),
    ];
    expect(seriesOrder(posts, 's').map((p) => p.item.slug)).toEqual(['part-one', 'part-two']);
  });
});

describe('table of contents', () => {
  it('lists h2 and h3 by default', () => {
    const body = '# One\n\n## Two\n\n### Three\n\n#### Four\n';
    expect(tableOfContents(body).map((entry) => entry.text)).toEqual(['Two', 'Three']);
  });

  it('ignores a hash inside a fenced code block', () => {
    const body = '## Real heading\n\n```bash\n## not a heading\n```\n';
    expect(tableOfContents(body)).toHaveLength(1);
  });

  it('strips inline markup from the text', () => {
    expect(tableOfContents('## A **bold** [link](/x)\n')[0]?.text).toBe('A bold link');
  });

  it('de-duplicates repeated headings', () => {
    const slugs = tableOfContents('## Notes\n\n## Notes\n').map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(2);
  });

  it('reads the real headings out of the sample body', () => {
    expect(tableOfContents(SAMPLE_BODY)).toEqual([]);
  });
});

describe('headingSlug', () => {
  it('matches the anchor a Markdown pipeline generates for Latin text', () => {
    expect(headingSlug('What the record actually shows')).toBe('what-the-record-actually-shows');
  });

  it('keeps Thaana vowel marks, which are combining marks rather than letters', () => {
    // Dropping them produced a table of contents whose links matched no heading.
    const slug = headingSlug('މާޖިންގެ ނޯޓުތައް');
    expect(slug).toBe('މާޖިންގެ-ނޯޓުތައް');
    expect(slug).toContain('ާ');
  });

  it('drops the Thaana question mark, as a slugger does', () => {
    expect(headingSlug('އެއިން ލިބެނީ ކޮންއެއްޗެއް؟')).toBe('އެއިން-ލިބެނީ-ކޮންއެއްޗެއް');
  });

  it('keeps Arabic harakat', () => {
    expect(headingSlug('مُحَمَّد')).toBe('مُحَمَّد');
  });
});

describe('pagination', () => {
  const items = Array.from({ length: 11 }, (_, index) => index);

  it('slices the requested page', () => {
    expect(paginate(items, 5, 2).items).toEqual([5, 6, 7, 8, 9]);
  });

  it('reports totals and neighbours', () => {
    const page = paginate(items, 5, 2);
    expect(page.total).toBe(3);
    expect(page.hasPrevious).toBe(true);
    expect(page.hasNext).toBe(true);
  });

  it('clamps an out-of-range page rather than returning nothing', () => {
    expect(paginate(items, 5, 99).current).toBe(3);
    expect(paginate(items, 5, 0).current).toBe(1);
  });

  it('reports one page for an empty list', () => {
    const page = paginate([], 5, 1);
    expect(page.total).toBe(1);
    expect(page.items).toEqual([]);
    expect(page.hasNext).toBe(false);
  });
});
