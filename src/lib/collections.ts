import type { Post } from './schemas';
import { LOCALES, type LocaleCode } from './i18n';

/**
 * Collection queries.
 *
 * Everything here is a pure function over plain data. That is deliberate: the Astro glue
 * in `src/lib/content.ts` imports `astro:content`, which is a virtual module that only
 * exists inside a build, so anything living there cannot be unit-tested. The rules that
 * actually matter -- what is publishable, what order things appear in, which posts are
 * related -- live here instead, where a test can reach them.
 */

export interface PostLike {
  readonly item: Post;
  /** Rendered or raw body, used for reading time and related-post scoring. */
  readonly body: string;
}

export interface VisibilityOptions {
  /** Injected rather than read from the clock so builds are reproducible. */
  readonly now: Date;
  /** Preview builds only. A public build must never set this. */
  readonly includeDrafts?: boolean;
}

/**
 * Posts allowed into a public build.
 *
 * A draft is unfinished work and a future-dated post is scheduled; emitting either is a
 * silent publication. This is the same rule the content adapters apply when projecting to
 * a target site, and it is applied again here because the control plane's own front end
 * is a build like any other.
 */
export function visiblePosts<T extends PostLike>(
  posts: readonly T[],
  options: VisibilityOptions,
): T[] {
  return posts.filter(({ item }) => {
    if (item.draft && options.includeDrafts !== true) return false;
    if (item.state === 'rejected') return false;
    // `seo.noindex` is deliberately not a visibility rule. It keeps a page out of search
    // engines and out of the sitemap; the page itself still renders and is still linkable,
    // which is the whole point of an unlisted page.
    return item.publishedDate.getTime() <= options.now.getTime();
  });
}

/** Newest first, with pinned posts held at the top in their own date order. */
export function sortForListing<T extends PostLike>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => {
    if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
    return b.item.publishedDate.getTime() - a.item.publishedDate.getTime();
  });
}

export function byLocale<T extends PostLike>(posts: readonly T[], locale: LocaleCode): T[] {
  return posts.filter(({ item }) => item.locale === locale);
}

export function byCategory<T extends PostLike>(posts: readonly T[], category: string): T[] {
  return posts.filter(({ item }) => item.category === category);
}

export function byTag<T extends PostLike>(posts: readonly T[], tag: string): T[] {
  return posts.filter(({ item }) => item.tags.includes(tag));
}

export function byAuthor<T extends PostLike>(posts: readonly T[], author: string): T[] {
  return posts.filter(({ item }) => item.author === author);
}

/** Distinct categories in a locale, with counts, ordered by count then name. */
export function categoryCounts<T extends PostLike>(
  posts: readonly T[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { item } of posts) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function tagCounts<T extends PostLike>(
  posts: readonly T[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { item } of posts) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Reading time in whole minutes, never zero.
 *
 * Words-per-minute differs by script: Thaana and Arabic are read more slowly than Latin
 * by most readers, and counting their words at an English rate produces a figure that is
 * confidently wrong. Code blocks are excluded because nobody reads them at prose speed.
 */
export function readingTimeMinutes(body: string, locale: LocaleCode): number {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  const words = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  const wordsPerMinute = LOCALES[locale].script === 'Latn' ? 220 : 160;
  return Math.max(1, Math.round(words / wordsPerMinute));
}

/* ------------------------------------------------------------------ *
 * Related posts
 * ------------------------------------------------------------------ */

/**
 * Related posts, scored at build time.
 *
 * No third-party recommendation script, no client-side work: a shared category is worth
 * more than a shared tag, a shared series more than either, and recency breaks ties. The
 * post itself and anything in another locale are never candidates -- offering a reader a
 * "related" article they cannot read is worse than offering none.
 */
export function relatedPosts<T extends PostLike>(
  target: PostLike,
  candidates: readonly T[],
  limit = 3,
): T[] {
  const scored = candidates
    .filter(({ item }) => item.slug !== target.item.slug && item.locale === target.item.locale)
    .map((candidate) => ({ candidate, score: relatednessScore(target.item, candidate.item) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.candidate.item.publishedDate.getTime() - a.candidate.item.publishedDate.getTime(),
    );

  return scored.slice(0, limit).map(({ candidate }) => candidate);
}

function relatednessScore(target: Post, candidate: Post): number {
  let score = 0;
  if (target.series && candidate.series === target.series) score += 6;
  if (candidate.category === target.category) score += 3;
  const sharedTags = candidate.tags.filter((tag) => target.tags.includes(tag)).length;
  score += sharedTags * 2;
  return score;
}

/* ------------------------------------------------------------------ *
 * Series, prev/next
 * ------------------------------------------------------------------ */

/** Neighbours in listing order, for the article footer. */
export function neighbours<T extends PostLike>(
  posts: readonly T[],
  slug: string,
): { previous: T | undefined; next: T | undefined } {
  const ordered = sortForListing(posts);
  const index = ordered.findIndex(({ item }) => item.slug === slug);
  if (index === -1) return { previous: undefined, next: undefined };
  // "Previous" reads as the older post, which is the later entry in a newest-first list.
  return { previous: ordered[index + 1], next: ordered[index - 1] };
}

/** Posts in a series, in reading order rather than publication order. */
export function seriesOrder<T extends PostLike>(posts: readonly T[], series: string): T[] {
  return posts
    .filter(({ item }) => item.series === series)
    .sort((a, b) => {
      const left = a.item.seriesIndex ?? Number.MAX_SAFE_INTEGER;
      const right = b.item.seriesIndex ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.item.publishedDate.getTime() - b.item.publishedDate.getTime();
    });
}

/* ------------------------------------------------------------------ *
 * Table of contents
 * ------------------------------------------------------------------ */

export interface TocEntry {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
}

/**
 * Headings for the on-this-page list, read straight out of the Markdown source.
 *
 * Fenced code is stripped first: a `# comment` line inside a shell block is not a heading,
 * and a table of contents that lists one looks broken in a way readers notice immediately.
 */
export function tableOfContents(body: string, minDepth = 2, maxDepth = 3): TocEntry[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '');
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();

  for (const line of withoutCode.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const depth = match[1]?.length ?? 0;
    const rawText = match[2] ?? '';
    if (depth < minDepth || depth > maxDepth) continue;

    const text = rawText
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    if (text === '') continue;

    const base = headingSlug(text);
    const previous = seen.get(base);
    const slug = previous === undefined ? base : `${base}-${previous + 1}`;
    seen.set(base, (previous ?? 0) + 1);

    entries.push({ depth, text, slug });
  }

  return entries;
}

/**
 * Heading anchor id.
 *
 * Deliberately NOT the Thaana-transliterating `slugify` used for URLs: this has to match
 * the id Astro's Markdown pipeline generates for the same heading, and that pipeline
 * keeps non-Latin characters rather than romanising them. A table of contents whose links
 * do not match the headings they point at is worse than no table of contents.
 */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // `\p{M}` is load-bearing. Thaana vowels (fili) and Arabic harakat are combining
      // marks, not letters, so a `\p{L}\p{N}` keep-set silently deletes every vowel in a
      // Dhivehi heading. Astro's slugger keeps them, so dropping them here produced a
      // table of contents whose links matched nothing -- caught by `pnpm check:links`.
      .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/* ------------------------------------------------------------------ *
 * Pagination
 * ------------------------------------------------------------------ */

export interface Page<T> {
  readonly items: readonly T[];
  readonly current: number;
  readonly total: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export function paginate<T>(items: readonly T[], pageSize: number, current: number): Page<T> {
  const total = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, current), total);
  const start = (clamped - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    current: clamped,
    total,
    hasPrevious: clamped > 1,
    hasNext: clamped < total,
  };
}
