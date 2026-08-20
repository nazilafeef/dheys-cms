import type { APIRoute } from 'astro';
import { buildAtom } from '@lib/feeds';
import { feedEntries, feedMeta, latestUpdate } from '@lib/feed-data';

export const GET: APIRoute = async ({ site }) => {
  const ctx = { site: site?.href ?? 'http://localhost:4321', base: import.meta.env.BASE_URL };
  const entries = await feedEntries(ctx);
  const meta = feedMeta(ctx, '/atom.xml', latestUpdate(entries, new Date()));

  return new Response(buildAtom(meta, entries), {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
