import { getCollection, type CollectionEntry } from 'astro:content';
import {
  postSchema,
  pageSchema,
  authorSchema,
  categorySchema,
  toFieldErrors,
  type Post,
  type Page as PageItem,
  type Author,
  type Category,
} from './schemas';
import { visiblePosts, sortForListing, type PostLike } from './collections';
import type { LocaleCode } from './i18n';

/**
 * Astro glue.
 *
 * This is the only module that imports `astro:content`, which is a virtual module that
 * exists only inside a build. Everything with a rule in it lives in `collections.ts`
 * instead, where a unit test can reach it; this file just reads collections, validates
 * them against the single authoritative schema, and hands back plain data.
 *
 * Validation failures stop the build. That is deliberate: a post with no `category` that
 * renders anyway becomes a page with a broken breadcrumb, a missing feed entry and a
 * sitemap URL nobody can categorise — three small bugs instead of one loud one.
 */

export interface LoadedPost extends PostLike {
  /** Collection entry id, i.e. the path under `src/content/posts` without its extension. */
  readonly id: string;
  readonly item: Post;
  readonly body: string;
  readonly entry: CollectionEntry<'posts'>;
}

export interface LoadedPage {
  readonly id: string;
  readonly item: PageItem;
  readonly body: string;
  readonly entry: CollectionEntry<'pages'>;
}

class ContentValidationError extends Error {
  constructor(
    collection: string,
    id: string,
    problems: readonly { field: string; message: string }[],
  ) {
    const detail = problems.map((problem) => `    ${problem.field}: ${problem.message}`).join('\n');
    super(
      `Content in "${collection}" failed validation.\n\n` +
        `  File: src/content/${collection}/${id}\n` +
        `${detail}\n\n` +
        `  This is the same schema the CMS validates agent output against, so the fix is\n` +
        `  the same either way: correct the frontmatter field named above.`,
    );
    this.name = 'ContentValidationError';
  }
}

function parseOrThrow<T>(
  collection: string,
  id: string,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: unknown } },
  data: unknown,
): T {
  const result = schema.safeParse(data);
  if (result.success && result.data !== undefined) return result.data;
  const errors = toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
  throw new ContentValidationError(collection, id, errors);
}

/* ------------------------------------------------------------------ *
 * Posts
 * ------------------------------------------------------------------ */

let postCache: LoadedPost[] | undefined;

/** Every post in the repository, validated. Cached because a build asks many times. */
export async function allPosts(): Promise<LoadedPost[]> {
  if (postCache) return postCache;
  const entries = await getCollection('posts');
  postCache = entries.map((entry) => ({
    id: entry.id,
    item: parseOrThrow<Post>('posts', entry.id, postSchema, entry.data),
    body: entry.body ?? '',
    entry,
  }));
  return postCache;
}

/**
 * Posts a public build may render, newest first.
 *
 * `now` defaults to build time. Passing it explicitly is what lets a test or a preview
 * build reason about a fixed instant instead of whenever the build happened to run.
 */
export async function publishedPosts(options: {
  locale?: LocaleCode;
  now?: Date;
  includeDrafts?: boolean;
}): Promise<LoadedPost[]> {
  const posts = await allPosts();
  const visible = visiblePosts(posts, {
    now: options.now ?? new Date(),
    ...(options.includeDrafts === undefined ? {} : { includeDrafts: options.includeDrafts }),
  });
  const scoped =
    options.locale === undefined
      ? visible
      : visible.filter(({ item }) => item.locale === options.locale);
  return sortForListing(scoped);
}

export async function postBySlug(
  slug: string,
  locale: LocaleCode,
): Promise<LoadedPost | undefined> {
  const posts = await allPosts();
  return posts.find(({ item }) => item.slug === slug && item.locale === locale);
}

/**
 * Locales a logical article exists in, for `hreflang` and the language switcher.
 *
 * Translations are linked by `translationOf` pointing at the original's slug. A reader on
 * the Dhivehi version needs the switcher to offer the English one, so the lookup has to
 * work in both directions.
 */
export async function translationsOf(post: LoadedPost): Promise<Map<LocaleCode, LoadedPost>> {
  const posts = await allPosts();
  const originSlug = post.item.translationOf ?? post.item.slug;
  const family = posts.filter(
    ({ item }) => item.slug === originSlug || item.translationOf === originSlug,
  );
  const byLocaleCode = new Map<LocaleCode, LoadedPost>();
  for (const candidate of family) byLocaleCode.set(candidate.item.locale, candidate);
  return byLocaleCode;
}

/* ------------------------------------------------------------------ *
 * Pages, authors, categories
 * ------------------------------------------------------------------ */

export async function allPages(): Promise<LoadedPage[]> {
  const entries = await getCollection('pages');
  return entries.map((entry) => ({
    id: entry.id,
    item: parseOrThrow<PageItem>('pages', entry.id, pageSchema, entry.data),
    body: entry.body ?? '',
    entry,
  }));
}

export async function publishedPages(locale?: LocaleCode): Promise<LoadedPage[]> {
  const pages = await allPages();
  return pages.filter(
    ({ item }) => !item.draft && (locale === undefined || item.locale === locale),
  );
}

export async function pageBySlug(
  slug: string,
  locale: LocaleCode,
): Promise<LoadedPage | undefined> {
  const pages = await allPages();
  return pages.find(({ item }) => item.slug === slug && item.locale === locale);
}

export async function allAuthors(): Promise<Author[]> {
  const entries = await getCollection('authors');
  return entries.map((entry) =>
    parseOrThrow<Author>('authors', entry.id, authorSchema, entry.data),
  );
}

export async function allCategories(): Promise<Category[]> {
  const entries = await getCollection('categories');
  return entries.map((entry) =>
    parseOrThrow<Category>('categories', entry.id, categorySchema, entry.data),
  );
}

/** Display name for a category slug, falling back to the slug so nothing renders blank. */
export async function categoryName(slug: string): Promise<string> {
  const categories = await allCategories();
  return categories.find((category) => category.slug === slug)?.name ?? slug;
}

/** Author record for a byline, if one exists. Bylines are free text, so this may miss. */
export async function authorByName(name: string): Promise<Author | undefined> {
  const authors = await allAuthors();
  return authors.find((author) => author.name === name);
}
