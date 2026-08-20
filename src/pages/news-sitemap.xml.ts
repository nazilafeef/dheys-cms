import type { APIRoute } from 'astro';
import { buildNewsSitemap } from '@lib/feeds';
import { newsSitemapEntries } from '@lib/feed-data';

/**
 * Google News sitemap. Only the last two days of articles belong in it -- the builder
 * enforces that, so a quiet week correctly produces an empty (but valid) document rather
 * than a stale one.
 */
export const GET: APIRoute = async ({ site }) => {
  const ctx = { site: site?.href ?? 'http://localhost:4321', base: import.meta.env.BASE_URL };

  return new Response(buildNewsSitemap(await newsSitemapEntries(ctx), new Date()), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};
