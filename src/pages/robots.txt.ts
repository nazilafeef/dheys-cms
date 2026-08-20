import type { APIRoute } from 'astro';
import { buildRobots } from '@lib/feeds';
import { canonicalUrl } from '@lib/paths';
import { routes } from '@lib/routes';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.href ?? 'http://localhost:4321';
  const base = import.meta.env.BASE_URL;

  const body = buildRobots({
    sitemapUrl: canonicalUrl(routes.sitemap(base), origin, base),
    newsSitemapUrl: canonicalUrl(routes.newsSitemap(base), origin, base),
    // The admin is a client-side app behind a token. There is nothing there for a crawler
    // to index, and an indexed sign-in screen is a phishing lookalike waiting to happen.
    disallow: [routes.admin(base)],
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
