import { withBase } from './paths';
import { DEFAULT_LOCALE, type LocaleCode } from './i18n';

/**
 * Route construction.
 *
 * Two things are being juggled at once and both are easy to get wrong:
 *
 *  - the deployment base (`/dheys-cms` on a project page, `/` everywhere else), and
 *  - the locale segment (absent for the default locale, `/dv` or `/ar` otherwise).
 *
 * Every link in the site is built here so those two rules exist in exactly one place.
 * Nothing else may concatenate a locale or a base by hand.
 *
 * The route table also has to match the file layout under `src/pages`, which uses rest
 * parameters (`[...locale]`) so one template serves every locale. If a route here and a
 * page file there disagree, `pnpm check:links` fails the build.
 */

export interface RouteContext {
  readonly locale: LocaleCode;
  /** `import.meta.env.BASE_URL`, which Astro supplies with a trailing slash. */
  readonly base: string;
}

/** The locale prefix for a path, empty for the default locale. */
function localeSegment(locale: LocaleCode): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

function build(ctx: RouteContext, path: string): string {
  const suffix = path === '/' ? '' : path;
  const full = `${localeSegment(ctx.locale)}${suffix}`;
  return withBase(full === '' ? '/' : full, ctx.base);
}

export const routes = {
  home: (ctx: RouteContext): string => build(ctx, '/'),
  archive: (ctx: RouteContext): string => build(ctx, '/archive'),
  search: (ctx: RouteContext): string => build(ctx, '/search'),
  article: (ctx: RouteContext, slug: string): string => build(ctx, `/articles/${slug}`),
  category: (ctx: RouteContext, category: string): string => build(ctx, `/category/${category}`),
  author: (ctx: RouteContext, author: string): string => build(ctx, `/author/${author}`),
  page: (ctx: RouteContext, slug: string): string => build(ctx, `/${slug}`),

  /** Feeds and machine-readable files are not localised — one per site. */
  rss: (base: string): string => withBase('/rss.xml', base),
  atom: (base: string): string => withBase('/atom.xml', base),
  jsonFeed: (base: string): string => withBase('/feed.json', base),
  sitemap: (base: string): string => withBase('/sitemap.xml', base),
  newsSitemap: (base: string): string => withBase('/news-sitemap.xml', base),
  robots: (base: string): string => withBase('/robots.txt', base),
  llms: (base: string): string => withBase('/llms.txt', base),
  admin: (base: string): string => withBase('/admin', base),
  notFound: (base: string): string => withBase('/404', base),
} as const;

/**
 * The `locale` rest-parameter value for a page file under `src/pages/[...locale]/`.
 * `undefined` for the default locale, which is what makes `/` and `/dv` share a template.
 */
export function localeParam(locale: LocaleCode): string | undefined {
  return locale === DEFAULT_LOCALE ? undefined : locale;
}

/** Read a rest-parameter back into a locale, defaulting when it is absent. */
export function localeFromParam(param: string | undefined): LocaleCode {
  if (param === 'dv' || param === 'ar' || param === 'en') return param;
  return DEFAULT_LOCALE;
}
