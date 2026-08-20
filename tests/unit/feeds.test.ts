import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  rfc822,
  w3cDate,
  buildRss,
  buildAtom,
  buildJsonFeed,
  buildSitemap,
  buildNewsSitemap,
  buildRobots,
  buildLlmsTxt,
  type FeedEntry,
  type FeedMeta,
} from '@lib/feeds';

/**
 * Feeds are the part of a site nobody looks at until a reader's client quietly stops
 * updating. Every assertion here corresponds to a way that happens: a date in the wrong
 * format, an unescaped ampersand, a guid that changes, a news sitemap full of archive.
 */

const meta: FeedMeta = {
  title: 'Dheys CMS',
  description: 'A demonstration feed.',
  siteUrl: 'https://example.test/dheys-cms/',
  feedUrl: 'https://example.test/dheys-cms/rss.xml',
  locale: 'en',
  updated: new Date('2026-06-10T12:00:00.000Z'),
};

const entries: FeedEntry[] = [
  {
    title: 'Tides & tables',
    url: 'https://example.test/dheys-cms/articles/tides-and-tables',
    excerpt: 'An excerpt with <angle> brackets & an ampersand.',
    publishedDate: new Date('2026-06-08T08:00:00.000Z'),
    updatedDate: new Date('2026-06-09T08:00:00.000Z'),
    author: "O'Brien",
    locale: 'en',
    category: 'environment',
    tags: ['tides', 'measurement'],
  },
  {
    title: 'ބަނދަރުގެ ދިޔަވަރު',
    url: 'https://example.test/dheys-cms/dv/articles/bandharuge-dhiyavaru',
    excerpt: 'ކުރު ޚުލާޞާ',
    publishedDate: new Date('2026-06-01T08:00:00.000Z'),
    author: 'އެޑިޓަރު',
    locale: 'dv',
    category: 'thimaaveshi',
    tags: [],
  },
];

describe('escaping', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('escapes the ampersand first, so nothing is double-escaped', () => {
    // The classic bug: escaping < before & turns "&lt;" into "&amp;lt;".
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
    expect(escapeXml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('leaves Thaana and Arabic alone', () => {
    expect(escapeXml('ބަނދަރު')).toBe('ބަނދަރު');
  });
});

describe('date formats', () => {
  it('uses RFC 822 for RSS, not ISO 8601', () => {
    const formatted = rfc822(new Date('2026-06-08T08:00:00.000Z'));
    expect(formatted).toBe('Mon, 08 Jun 2026 08:00:00 GMT');
    // An RSS reader given an ISO 8601 pubDate either ignores the item's date or the item.
    expect(formatted).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('uses a date-only lastmod for sitemaps', () => {
    expect(w3cDate(new Date('2026-06-08T08:00:00.000Z'))).toBe('2026-06-08');
  });
});

describe('RSS 2.0', () => {
  const xml = buildRss(meta, entries);

  it('declares itself as RSS 2.0 with a self link', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('rel="self"');
  });

  it('emits one item per entry', () => {
    expect([...xml.matchAll(/<item>/g)]).toHaveLength(2);
  });

  it('marks the guid as a permalink, so a reader does not re-deliver moved articles', () => {
    expect(xml).toContain('<guid isPermaLink="true">');
  });

  it('escapes content rather than emitting invalid XML', () => {
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;angle&gt;');
    expect(xml).not.toMatch(/<description>[^<]*<angle>/);
  });

  it('carries the author and every category', () => {
    expect(xml).toContain('<dc:creator>O&apos;Brien</dc:creator>');
    expect(xml).toContain('<category>tides</category>');
    expect(xml).toContain('<category>measurement</category>');
  });

  it('is well-formed enough that every open tag closes', () => {
    for (const tag of ['rss', 'channel', 'item', 'title', 'link']) {
      const open = [...xml.matchAll(new RegExp(`<${tag}[ >]`, 'g'))].length;
      const close = [...xml.matchAll(new RegExp(`</${tag}>`, 'g'))].length;
      expect(open, `<${tag}> open/close mismatch`).toBe(close);
    }
  });
});

describe('Atom', () => {
  const xml = buildAtom(meta, entries);

  it('sets the feed language and a stable id', () => {
    expect(xml).toContain('xml:lang="en"');
    expect(xml).toContain(`<id>${meta.siteUrl}</id>`);
  });

  it('uses ISO 8601, which is what Atom requires', () => {
    expect(xml).toContain('<published>2026-06-08T08:00:00.000Z</published>');
  });

  it('falls back to the published date when an entry was never updated', () => {
    expect(xml).toContain('<updated>2026-06-01T08:00:00.000Z</updated>');
  });
});

describe('JSON Feed', () => {
  const json = buildJsonFeed(meta, entries);
  const parsed = JSON.parse(json) as {
    version: string;
    items: Array<Record<string, unknown>>;
  };

  it('is valid JSON declaring version 1.1', () => {
    expect(parsed.version).toBe('https://jsonfeed.org/version/1.1');
  });

  it('gives every item an id equal to its URL', () => {
    for (const item of parsed.items) {
      expect(item['id']).toBe(item['url']);
    }
  });

  it('tags each item with its own language, since the feed is multilingual', () => {
    expect(parsed.items.map((item) => item['language'])).toEqual(['en', 'dv']);
  });

  it('needs no escaping — JSON handles the ampersand itself', () => {
    expect(parsed.items[0]?.['summary']).toBe('An excerpt with <angle> brackets & an ampersand.');
  });
});

describe('sitemap', () => {
  it('emits a urlset with lastmod, changefreq and priority', () => {
    const xml = buildSitemap([
      {
        loc: 'https://example.test/dheys-cms/',
        lastmod: new Date('2026-06-08T08:00:00.000Z'),
        changefreq: 'daily',
        priority: 1,
      },
    ]);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://example.test/dheys-cms/</loc>');
    expect(xml).toContain('<lastmod>2026-06-08</lastmod>');
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
  });

  it('omits optional fields rather than emitting empty elements', () => {
    const xml = buildSitemap([{ loc: 'https://example.test/x' }]);
    expect(xml).not.toContain('<lastmod>');
    expect(xml).not.toContain('<priority>');
  });

  it('emits xhtml alternates so a crawler finding one language finds the rest', () => {
    const xml = buildSitemap([
      {
        loc: 'https://example.test/a',
        alternates: [
          { hreflang: 'en', href: 'https://example.test/a' },
          { hreflang: 'dv', href: 'https://example.test/dv/b' },
        ],
      },
    ]);
    expect(xml).toContain('xmlns:xhtml=');
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="dv" href="https://example.test/dv/b"/>',
    );
  });
});

describe('news sitemap', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');

  it('includes articles from the last two days', () => {
    const xml = buildNewsSitemap(
      [
        {
          loc: 'https://example.test/a',
          title: 'Recent',
          publishedDate: new Date('2026-06-09T12:00:00.000Z'),
          locale: 'en',
          publicationName: 'Dheys CMS',
        },
      ],
      now,
    );
    expect(xml).toContain('<news:title>Recent</news:title>');
  });

  it('excludes anything older, because a stale news sitemap is ignored wholesale', () => {
    const xml = buildNewsSitemap(
      [
        {
          loc: 'https://example.test/old',
          title: 'Archive piece',
          publishedDate: new Date('2026-01-01T00:00:00.000Z'),
          locale: 'en',
          publicationName: 'Dheys CMS',
        },
      ],
      now,
    );
    expect(xml).not.toContain('Archive piece');
    // Still a valid, empty document rather than a malformed one.
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
  });
});

describe('robots.txt', () => {
  const body = buildRobots({
    sitemapUrl: 'https://example.test/dheys-cms/sitemap.xml',
    newsSitemapUrl: 'https://example.test/dheys-cms/news-sitemap.xml',
    disallow: ['/dheys-cms/admin'],
  });

  it('points at both sitemaps', () => {
    expect(body).toContain('Sitemap: https://example.test/dheys-cms/sitemap.xml');
    expect(body).toContain('Sitemap: https://example.test/dheys-cms/news-sitemap.xml');
  });

  it('keeps the admin out of the index', () => {
    expect(body).toContain('Disallow: /dheys-cms/admin');
  });

  it('allows everything else', () => {
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
  });
});

describe('llms.txt', () => {
  const body = buildLlmsTxt({
    title: 'Dheys CMS',
    summary: 'A demonstration site.',
    notes: ['Everything here is invented.'],
    sections: [
      {
        heading: 'Articles in English',
        links: [{ title: 'Tides', url: 'https://example.test/a', note: 'About tides.' }],
      },
    ],
  });

  it('opens with a heading and a blockquote summary, as the format expects', () => {
    expect(body.startsWith('# Dheys CMS')).toBe(true);
    expect(body).toContain('> A demonstration site.');
  });

  it('renders sections as Markdown link lists', () => {
    expect(body).toContain('## Articles in English');
    expect(body).toContain('- [Tides](https://example.test/a): About tides.');
  });

  it('carries the notes that tell a model what it is reading', () => {
    expect(body).toContain('Everything here is invented.');
  });
});
