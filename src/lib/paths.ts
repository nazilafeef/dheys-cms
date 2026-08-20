/**
 * Base-path resolution.
 *
 * A GitHub Pages *project* site is served from a sub-path (`/dheys-cms/`), while a
 * user/apex site and most other hosts serve from the root (`/`). Getting this wrong
 * is the classic way a Pages deployment looks perfect on localhost and ships with
 * every stylesheet, script and link 404ing.
 *
 * Every URL the app emits goes through `withBase`. Nothing else in the codebase is
 * allowed to concatenate a base by hand -- `scripts/check-clean-room.mjs` is not the
 * guard for that, the code review is, but the unit tests in
 * tests/unit/paths.test.ts pin both hosting modes so a regression fails the gate.
 */

/** Schemes that must never be prefixed with a base path. */
const NON_PATH_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:', 'data:', '#'];

/**
 * A protocol-relative URL (`//cdn.example.com/x`) is external; a path that merely
 * arrived with a doubled slash (`//about`) is not. Distinguishing them on whether the
 * first segment looks like a host stops a malformed in-app path from silently becoming
 * a link to another origin.
 */
function isProtocolRelative(value: string): boolean {
  if (!value.startsWith('//')) return false;
  const [host = ''] = value.slice(2).split('/');
  return host.includes('.');
}

/**
 * Reduce any spelling of a base path to the canonical form:
 * root is exactly `/`, a sub-path is `/segment` with a leading and no trailing slash.
 *
 *   ''            -> '/'
 *   '/'           -> '/'
 *   'dheys-cms'   -> '/dheys-cms'
 *   '/dheys-cms/' -> '/dheys-cms'
 *   '//a//b//'    -> '/a/b'
 */
export function normaliseBase(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return '/';
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === '/') return '/';
  const segments = trimmed.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`;
}

/** True when the value addresses something other than a path on this site. */
export function isExternalRef(value: string): boolean {
  if (isProtocolRelative(value)) return true;
  return NON_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Join an in-app path onto the deployment base. Idempotent: a path that already
 * carries the base is returned unchanged, so it is safe to call on a value of
 * unknown provenance.
 */
export function withBase(path: string, base: string | undefined = '/'): string {
  if (path === '') return withBase('/', base);
  if (isExternalRef(path)) return path;

  const normalisedBase = normaliseBase(base);
  const [pathOnly = '', ...rest] = splitSuffix(path);
  const suffix = rest.join('');

  const cleanPath = `/${pathOnly.split('/').filter(Boolean).join('/')}`;

  if (normalisedBase === '/') return `${cleanPath}${suffix}`;

  if (cleanPath === normalisedBase || cleanPath.startsWith(`${normalisedBase}/`)) {
    return `${cleanPath}${suffix}`;
  }

  if (cleanPath === '/') return `${normalisedBase}${suffix || '/'}`;
  return `${normalisedBase}${cleanPath}${suffix}`;
}

/** Remove the deployment base from a request pathname, yielding an app-relative path. */
export function stripBase(pathname: string, base: string | undefined = '/'): string {
  const normalisedBase = normaliseBase(base);
  if (normalisedBase === '/') return ensureLeadingSlash(pathname);
  const withLeading = ensureLeadingSlash(pathname);
  if (withLeading === normalisedBase) return '/';
  if (withLeading.startsWith(`${normalisedBase}/`)) {
    const remainder = withLeading.slice(normalisedBase.length);
    return remainder === '' ? '/' : remainder;
  }
  return withLeading;
}

/**
 * Absolute, canonical URL for an in-app path. Used for `<link rel="canonical">`,
 * OpenGraph, feeds, sitemap and JSON-LD -- all of which are wrong if they carry a
 * relative or base-less path.
 */
export function canonicalUrl(path: string, site: string, base: string | undefined = '/'): string {
  const origin = site.endsWith('/') ? site.slice(0, -1) : site;
  if (isExternalRef(path) && !path.startsWith('#')) return path;
  return `${origin}${withBase(path, base)}`;
}

/** Split a path into [pathname, ...('?'|'#') suffix] so query/hash survive joining. */
function splitSuffix(value: string): string[] {
  const queryIndex = value.search(/[?#]/);
  if (queryIndex === -1) return [value];
  return [value.slice(0, queryIndex), value.slice(queryIndex)];
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}
