import { publishedPosts, allPages } from './content';
import { canonicalUrl } from './paths';
import { routes } from './routes';
import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from './i18n';
import type { FeedEntry, SitemapUrl, NewsSitemapEntry } from './feeds';

/**
 * Shared assembly for every feed, sitemap and machine-readable endpoint.
 *
 * All of them need the same thing -- published posts, as absolute URLs, in every locale --
 * and getting that subtly different in six files is how a sitemap ends up listing a draft.
 */

export const SITE_TITLE = 'Dheys CMS';
export const SITE_DESCRIPTION =
  'Multi-site content platform for human and AI-authored editorial workflows, running on static hosting with no server and no database.';

export interface FeedContext {
  /** `Astro.site` — the deployment origin. */
  readonly site: string;
  /** `import.meta.env.BASE_URL`. */
  readonly base: string;
  readonly now?: Date;
}

function absolute(ctx: FeedContext, path: string): string {
  return canonicalUrl(path, ctx.site, ctx.base);
}

/** Every published post across every locale, newest first. */
export async function feedEntries(ctx: FeedContext): Promise<FeedEntry[]> {
  const posts = await publishedPosts({ ...(ctx.now ? { now: ctx.now } : {}) });
  return posts
    .filter(({ item }) => !item.seo.noindex)
    .map(({ item }) => ({
      title: item.title,
      url: absolute(ctx, routes.article({ locale: item.locale, base: ctx.base }, item.slug)),
      excerpt: item.excerpt,
      publishedDate: item.publishedDate,
      updatedDate: item.updatedDate,
      author: item.author,
      locale: item.locale,
      category: item.category,
      tags: item.tags,
    }));
}

/**
 * Every URL that belongs in a sitemap.
 *
 * Excludes anything marked `noindex`, anything still a draft, and `/search`, which is a
 * tool rather than a document. Includes `hreflang` alternates per article, since the whole
 * point of shipping three locales is that a crawler can find all three.
 */
export async function sitemapUrls(ctx: FeedContext): Promise<SitemapUrl[]> {
  const posts = await publishedPosts({ ...(ctx.now ? { now: ctx.now } : {}) });
  const pages = await allPages();
  const urls: SitemapUrl[] = [];

  for (const locale of LOCALE_CODES) {
    const localeCtx = { locale, base: ctx.base };
    const hasContent = posts.some(({ item }) => item.locale === locale);
    if (!hasContent) continue;

    urls.push({
      loc: absolute(ctx, routes.home(localeCtx)),
      changefreq: 'daily',
      priority: locale === DEFAULT_LOCALE ? 1 : 0.8,
    });
    urls.push({
      loc: absolute(ctx, routes.archive(localeCtx)),
      changefreq: 'weekly',
      priority: 0.5,
    });
  }

  for (const { item } of posts) {
    if (item.seo.noindex) continue;
    const localeCtx = { locale: item.locale, base: ctx.base };

    // Alternates come from the translation family, so a crawler that finds one language
    // finds the rest.
    const family = posts.filter(
      ({ item: other }) =>
        (other.translationOf ?? other.slug) === (item.translationOf ?? item.slug),
    );
    const alternates = family.map(({ item: other }) => ({
      hreflang: other.locale as string,
      href: absolute(ctx, routes.article({ locale: other.locale, base: ctx.base }, other.slug)),
    }));

    urls.push({
      loc: absolute(ctx, routes.article(localeCtx, item.slug)),
      lastmod: item.updatedDate ?? item.publishedDate,
      changefreq: 'monthly',
      priority: item.featured ? 0.8 : 0.6,
      ...(alternates.length > 1 ? { alternates } : {}),
    });
  }

  for (const { item } of pages) {
    if (item.draft || item.seo.noindex) continue;
    urls.push({
      loc: absolute(ctx, routes.page({ locale: item.locale, base: ctx.base }, item.slug)),
      ...(item.updatedDate ? { lastmod: item.updatedDate } : {}),
      changefreq: 'yearly',
      priority: 0.3,
    });
  }

  return urls;
}

export async function newsSitemapEntries(ctx: FeedContext): Promise<NewsSitemapEntry[]> {
  const posts = await publishedPosts({ ...(ctx.now ? { now: ctx.now } : {}) });
  return posts
    .filter(({ item }) => !item.seo.noindex)
    .map(({ item }) => ({
      loc: absolute(ctx, routes.article({ locale: item.locale, base: ctx.base }, item.slug)),
      title: item.title,
      publishedDate: item.publishedDate,
      locale: item.locale as LocaleCode,
      publicationName: SITE_TITLE,
    }));
}

export function feedMeta(ctx: FeedContext, feedPath: string, updated: Date) {
  return {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteUrl: absolute(ctx, '/'),
    feedUrl: absolute(ctx, feedPath),
    locale: DEFAULT_LOCALE,
    updated,
  };
}

/** Most recent publication date, or now if there is nothing published yet. */
export function latestUpdate(entries: readonly FeedEntry[], fallback: Date): Date {
  const newest = entries.reduce<Date | undefined>((latest, entry) => {
    const candidate = entry.updatedDate ?? entry.publishedDate;
    return latest === undefined || candidate > latest ? candidate : latest;
  }, undefined);
  return newest ?? fallback;
}
