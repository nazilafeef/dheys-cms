/**
 * Route extraction and the before/after diff.
 *
 * This is the part of the connector that decides whether a migration is allowed to
 * proceed. The rule it enforces is simple and absolute: **a migration may not lose a URL.**
 *
 * Everything else the connector does is recoverable — a wrong adapter can be swapped, an
 * over-eager CMS removal can be reverted from git. A dropped URL is different. It is a
 * dead link in somebody else's article, a 404 in a search index, a lost reader, and it is
 * usually noticed weeks later by someone who cannot say what changed.
 *
 * So the connector enumerates the target's routes before it touches anything, enumerates
 * them again afterwards, and refuses the migration if the second set does not cover the
 * first. Redirects count as coverage; a redirect is a promise the URL still resolves.
 */

export interface RouteSet {
  /** Site-absolute paths, e.g. `/articles/the-tide-gauge`. */
  readonly paths: readonly string[];
  /** Old path -> new path, for URLs the target deliberately moved. */
  readonly redirects?: Readonly<Record<string, string>>;
}

export interface RouteDiff {
  /** Paths present before and still reachable after. */
  readonly kept: readonly string[];
  /** Paths that existed before and resolve to nothing after. This must be empty. */
  readonly lost: readonly string[];
  /** Paths that exist only after. New pages are fine and are reported, not blocked. */
  readonly added: readonly string[];
  /** Paths that survive only because a redirect covers them. */
  readonly redirected: ReadonlyArray<{ from: string; to: string }>;
  /** True only when nothing was lost. */
  readonly safe: boolean;
}

/**
 * Normalise a path for comparison.
 *
 * Trailing slashes, index files, casing and percent-encoding all vary between static
 * hosts and frameworks; treating `/about/`, `/about` and `/about/index.html` as three
 * different URLs would make every migration look catastrophic.
 */
export function normalisePath(path: string): string {
  let value = path.trim();

  // Absolute URLs reduce to their path, so a route list may mix the two.
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      /* keep the raw value */
    }
  }

  value = value.split('?')[0] ?? value;
  value = value.split('#')[0] ?? value;

  try {
    value = decodeURIComponent(value);
  } catch {
    /* leave a malformed escape alone rather than throwing */
  }

  if (!value.startsWith('/')) value = `/${value}`;

  value = value.replace(/\/index\.html?$/i, '/');
  value = value.replace(/\.html?$/i, '');
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');

  return value === '' ? '/' : value.toLowerCase();
}

/** Routes from a list of built files, as a static host would serve them. */
export function routesFromFiles(files: readonly string[]): string[] {
  const paths = new Set<string>();

  for (const file of files) {
    if (!/\.html?$/i.test(file)) continue;
    paths.add(normalisePath(file.startsWith('/') ? file : `/${file}`));
  }

  return [...paths].sort();
}

/**
 * Compare the routes a site served before a migration with the ones it serves after.
 *
 * Coverage, not equality: new pages are expected and welcome. Only disappearance is a
 * failure.
 */
export function diffRoutes(before: RouteSet, after: RouteSet): RouteDiff {
  const beforePaths = [...new Set(before.paths.map(normalisePath))].sort();
  const afterPaths = new Set(after.paths.map(normalisePath));

  const redirects = new Map<string, string>();
  for (const [from, to] of Object.entries(after.redirects ?? {})) {
    redirects.set(normalisePath(from), normalisePath(to));
  }

  const kept: string[] = [];
  const lost: string[] = [];
  const redirected: Array<{ from: string; to: string }> = [];

  for (const path of beforePaths) {
    if (afterPaths.has(path)) {
      kept.push(path);
      continue;
    }

    const target = redirects.get(path);
    // A redirect only counts if its destination actually exists. A redirect to a 404 is a
    // 404 with extra steps, and is exactly the kind of thing that passes a careless check.
    if (target !== undefined && afterPaths.has(target)) {
      redirected.push({ from: path, to: target });
      continue;
    }

    lost.push(path);
  }

  const beforeSet = new Set(beforePaths);
  const added = [...afterPaths].filter((path) => !beforeSet.has(path)).sort();

  return { kept, lost, added, redirected, safe: lost.length === 0 };
}

/** Operator-readable diff, for the migration report and the CLI. */
export function formatRouteDiff(diff: RouteDiff): string {
  const lines: string[] = [];

  lines.push(
    diff.safe
      ? `Route diff: OK — ${diff.kept.length} URL(s) still resolve, ${diff.redirected.length} via a redirect, ${diff.added.length} new.`
      : `Route diff: FAILED — ${diff.lost.length} URL(s) would stop resolving.`,
  );

  if (diff.lost.length > 0) {
    lines.push('', 'Lost:');
    for (const path of diff.lost) lines.push(`  ${path}`);
    lines.push('', 'A migration may not lose a URL. Add a redirect, restore the route, or stop.');
  }

  if (diff.redirected.length > 0) {
    lines.push('', 'Redirected:');
    for (const entry of diff.redirected) lines.push(`  ${entry.from} -> ${entry.to}`);
  }

  if (diff.added.length > 0) {
    lines.push('', `New (${diff.added.length}):`);
    for (const path of diff.added.slice(0, 20)) lines.push(`  ${path}`);
    if (diff.added.length > 20) lines.push(`  … and ${diff.added.length - 20} more`);
  }

  return lines.join('\n');
}

/**
 * Routes named by a sitemap.
 *
 * Parsed with a regex rather than an XML parser on purpose: this reads whatever the target
 * site actually publishes, which is frequently not well-formed, and a strict parser that
 * throws would abandon the migration over a stray ampersand in somebody else's sitemap.
 */
export function routesFromSitemap(xml: string): string[] {
  const paths = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const raw = match[1];
    if (raw) paths.add(normalisePath(raw));
  }
  return [...paths].sort();
}
