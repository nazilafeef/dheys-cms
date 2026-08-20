import type { LocaleCode } from './i18n';

/**
 * Feeds, sitemaps and the machine-readable files.
 *
 * Pure string builders, deliberately, so `tests/unit/feeds.test.ts` can assert their shape
 * without a build. Feeds are the part of a site nobody looks at until a reader's client
 * silently stops updating, so they are worth pinning: a missing `<guid isPermaLink>`, an
 * unescaped ampersand or a `lastmod` in the wrong format each break a different consumer
 * and none of them break a build.
 */

export interface FeedEntry {
  readonly title: string;
  /** Absolute URL, including the deployment base. */
  readonly url: string;
  readonly excerpt: string;
  readonly publishedDate: Date;
  readonly updatedDate?: Date | undefined;
  readonly author: string;
  readonly locale: LocaleCode;
  readonly category: string;
  readonly tags: readonly string[];
  /** Rendered HTML, when the feed carries full content. */
  readonly contentHtml?: string | undefined;
}

export interface FeedMeta {
  readonly title: string;
  readonly description: string;
  /** Absolute URL of the site root, including the base. */
  readonly siteUrl: string;
  /** Absolute URL of this feed document. */
  readonly feedUrl: string;
  readonly locale: LocaleCode;
  readonly updated: Date;
}

/**
 * XML escaping.
 *
 * `&` must be replaced first, or the ampersands introduced by the other replacements get
 * double-escaped. This ordering is the entire reason this is a function and not an inline
 * chain of `.replace` calls somewhere.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 date, which is what RSS 2.0 requires and what breaks when you use ISO 8601. */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/** W3C date for `lastmod`: date only, which is what Google actually reads. */
export function w3cDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * RSS 2.0
 * ------------------------------------------------------------------ */

export function buildRss(meta: FeedMeta, entries: readonly FeedEntry[]): string {
  const items = entries
    .map((entry) =>
      [
        '    <item>',
        `      <title>${escapeXml(entry.title)}</title>`,
        `      <link>${escapeXml(entry.url)}</link>`,
        // isPermaLink="true" tells a reader the guid IS the URL, so an article that moves
        // is not re-delivered as a new item.
        `      <guid isPermaLink="true">${escapeXml(entry.url)}</guid>`,
        `      <description>${escapeXml(entry.excerpt)}</description>`,
        `      <pubDate>${rfc822(entry.publishedDate)}</pubDate>`,
        `      <dc:creator>${escapeXml(entry.author)}</dc:creator>`,
        `      <category>${escapeXml(entry.category)}</category>`,
        ...entry.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
        entry.contentHtml
          ? `      <content:encoded><![CDATA[${entry.contentHtml}]]></content:encoded>`
          : '',
        '    </item>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${escapeXml(meta.title)}</title>`,
    `    <link>${escapeXml(meta.siteUrl)}</link>`,
    `    <description>${escapeXml(meta.description)}</description>`,
    `    <language>${meta.locale}</language>`,
    `    <lastBuildDate>${rfc822(meta.updated)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(meta.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Atom
 * ------------------------------------------------------------------ */

export function buildAtom(meta: FeedMeta, entries: readonly FeedEntry[]): string {
  const items = entries
    .map((entry) =>
      [
        '  <entry>',
        `    <title>${escapeXml(entry.title)}</title>`,
        `    <link href="${escapeXml(entry.url)}"/>`,
        `    <id>${escapeXml(entry.url)}</id>`,
        `    <published>${entry.publishedDate.toISOString()}</published>`,
        `    <updated>${(entry.updatedDate ?? entry.publishedDate).toISOString()}</updated>`,
        `    <summary>${escapeXml(entry.excerpt)}</summary>`,
        `    <author><name>${escapeXml(entry.author)}</name></author>`,
        `    <category term="${escapeXml(entry.category)}"/>`,
        '  </entry>',
      ].join('\n'),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${meta.locale}">`,
    `  <title>${escapeXml(meta.title)}</title>`,
    `  <subtitle>${escapeXml(meta.description)}</subtitle>`,
    `  <link href="${escapeXml(meta.feedUrl)}" rel="self"/>`,
    `  <link href="${escapeXml(meta.siteUrl)}"/>`,
    `  <id>${escapeXml(meta.siteUrl)}</id>`,
    `  <updated>${meta.updated.toISOString()}</updated>`,
    items,
    '</feed>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * JSON Feed 1.1
 * ------------------------------------------------------------------ */

export function buildJsonFeed(meta: FeedMeta, entries: readonly FeedEntry[]): string {
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    description: meta.description,
    home_page_url: meta.siteUrl,
    feed_url: meta.feedUrl,
    language: meta.locale,
    items: entries.map((entry) => ({
      id: entry.url,
      url: entry.url,
      title: entry.title,
      summary: entry.excerpt,
      ...(entry.contentHtml
        ? { content_html: entry.contentHtml }
        : { content_text: entry.excerpt }),
      date_published: entry.publishedDate.toISOString(),
      ...(entry.updatedDate ? { date_modified: entry.updatedDate.toISOString() } : {}),
      authors: [{ name: entry.author }],
      tags: [entry.category, ...entry.tags],
      language: entry.locale,
    })),
  };
  return `${JSON.stringify(feed, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Sitemaps
 * ------------------------------------------------------------------ */

export interface SitemapUrl {
  readonly loc: string;
  readonly lastmod?: Date | undefined;
  readonly changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  readonly priority?: number;
  /** Alternate-language versions of this same page. */
  readonly alternates?: ReadonlyArray<{ hreflang: string; href: string }>;
}

export function buildSitemap(urls: readonly SitemapUrl[]): string {
  const entries = urls
    .map((url) =>
      [
        '  <url>',
        `    <loc>${escapeXml(url.loc)}</loc>`,
        url.lastmod ? `    <lastmod>${w3cDate(url.lastmod)}</lastmod>` : '',
        url.changefreq ? `    <changefreq>${url.changefreq}</changefreq>` : '',
        url.priority !== undefined ? `    <priority>${url.priority.toFixed(1)}</priority>` : '',
        ...(url.alternates ?? []).map(
          (alternate) =>
            `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`,
        ),
        '  </url>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

export interface NewsSitemapEntry {
  readonly loc: string;
  readonly title: string;
  readonly publishedDate: Date;
  readonly locale: LocaleCode;
  readonly publicationName: string;
}

/**
 * Google News sitemap.
 *
 * Only articles from the last two days belong here — that is the specification, and a
 * news sitemap listing a three-year archive is ignored wholesale rather than partially.
 */
export function buildNewsSitemap(
  entries: readonly NewsSitemapEntry[],
  now: Date = new Date(),
): string {
  const cutoff = now.getTime() - 2 * 24 * 60 * 60 * 1000;
  const recent = entries.filter((entry) => entry.publishedDate.getTime() >= cutoff);

  const items = recent
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        '    <news:news>',
        '      <news:publication>',
        `        <news:name>${escapeXml(entry.publicationName)}</news:name>`,
        `        <news:language>${entry.locale}</news:language>`,
        '      </news:publication>',
        `      <news:publication_date>${entry.publishedDate.toISOString()}</news:publication_date>`,
        `      <news:title>${escapeXml(entry.title)}</news:title>`,
        '    </news:news>',
        '  </url>',
      ].join('\n'),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    items,
    '</urlset>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * robots.txt and llms.txt
 * ------------------------------------------------------------------ */

export function buildRobots(options: {
  sitemapUrl: string;
  newsSitemapUrl: string;
  disallow?: readonly string[];
}): string {
  return [
    'User-agent: *',
    'Allow: /',
    ...(options.disallow ?? []).map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${options.sitemapUrl}`,
    `Sitemap: ${options.newsSitemapUrl}`,
    '',
  ].join('\n');
}

export interface LlmsSection {
  readonly heading: string;
  readonly links: ReadonlyArray<{ title: string; url: string; note?: string }>;
}

/**
 * `llms.txt` — a plain-language map of the site for a model reading it.
 *
 * Written as prose with links rather than as a dump of every URL: the format exists so a
 * model can orient itself cheaply, and a thousand-line index defeats that as thoroughly as
 * no file at all.
 */
export function buildLlmsTxt(options: {
  title: string;
  summary: string;
  sections: readonly LlmsSection[];
  notes?: readonly string[];
}): string {
  const lines = [`# ${options.title}`, '', `> ${options.summary}`, ''];

  for (const note of options.notes ?? []) {
    lines.push(note, '');
  }

  for (const section of options.sections) {
    lines.push(`## ${section.heading}`, '');
    for (const link of section.links) {
      lines.push(`- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
