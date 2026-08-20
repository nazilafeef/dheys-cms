import type { APIRoute } from 'astro';
import { buildSitemap } from '@lib/feeds';
import { sitemapUrls } from '@lib/feed-data';

export const GET: APIRoute = async ({ site }) => {
  const ctx = { site: site?.href ?? 'http://localhost:4321', base: import.meta.env.BASE_URL };

  return new Response(buildSitemap(await sitemapUrls(ctx)), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
