import type { APIRoute } from 'astro';
import { buildLlmsTxt } from '@lib/feeds';
import { publishedPosts, allPages } from '@lib/content';
import { canonicalUrl } from '@lib/paths';
import { routes } from '@lib/routes';
import { LOCALES, LOCALE_CODES } from '@lib/i18n';
import { SITE_TITLE, SITE_DESCRIPTION } from '@lib/feed-data';

/**
 * llms.txt -- a short, honest map of this site for a model reading it.
 *
 * Deliberately a guide rather than an index dump. It also states plainly which articles
 * were written with AI assistance, because a model ingesting this site should be able to
 * tell model-written prose from human-written prose.
 */
export const GET: APIRoute = async ({ site }) => {
  const origin = site?.href ?? 'http://localhost:4321';
  const base = import.meta.env.BASE_URL;
  const absolute = (path: string): string => canonicalUrl(path, origin, base);

  const posts = await publishedPosts({});
  const pages = await allPages();

  const sections = LOCALE_CODES.filter((locale) =>
    posts.some((post) => post.item.locale === locale),
  ).map((locale) => ({
    heading: `Articles in ${LOCALES[locale].name} (${LOCALES[locale].nativeName})`,
    links: posts
      .filter((post) => post.item.locale === locale && !post.item.seo.noindex)
      .map((post) => ({
        title: post.item.title,
        url: absolute(routes.article({ locale, base }, post.item.slug)),
        note:
          post.item.sourceType === 'ai' || post.item.sourceType === 'ai-assisted'
            ? `${post.item.excerpt} [written with ${post.item.provenance?.model ?? 'an AI model'}]`
            : post.item.excerpt,
      })),
  }));

  sections.push({
    heading: 'Pages',
    links: pages
      .filter((page) => !page.item.draft)
      .map((page) => ({
        title: `${page.item.title} (${page.item.locale})`,
        url: absolute(routes.page({ locale: page.item.locale, base }, page.item.slug)),
        note: page.item.excerpt ?? '',
      })),
  });

  const body = buildLlmsTxt({
    title: SITE_TITLE,
    summary: SITE_DESCRIPTION,
    notes: [
      'This site is the demonstration front end of an open-source CMS. Every article, author and site named here is invented; no real organisation is described.',
      'Articles produced with AI assistance are marked as such below and carry a machine-readable provenance block in their source, naming the model, the prompt version and the sources used.',
    ],
    sections,
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
