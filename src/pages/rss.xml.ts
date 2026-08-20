import type { APIRoute } from 'astro';
import { buildRss } from '@lib/feeds';
import { feedEntries, feedMeta, latestUpdate } from '@lib/feed-data';

/** RSS 2.0 for every locale in one feed; each item carries its own language tag. */
export const GET: APIRoute = async ({ site }) => {
  const ctx = { site: site?.href ?? 'http://localhost:4321', base: import.meta.env.BASE_URL };
  const entries = await feedEntries(ctx);
  const meta = feedMeta(ctx, '/rss.xml', latestUpdate(entries, new Date()));

  return new Response(buildRss(meta, entries), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
