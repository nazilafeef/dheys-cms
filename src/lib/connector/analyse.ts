import { parseDocument } from '../frontmatter';
import { slugify } from '../slug';
import { LOCALE_CODES, type LocaleCode } from '../i18n';

/**
 * Analysing a target repository.
 *
 * Everything here is a pure function over a file listing and a few file contents, so the
 * connector's judgement can be tested without cloning anything. `scripts/connect-site.mjs`
 * does the cloning and hands the results in.
 *
 * The analysis is deliberately conservative. Where it cannot tell, it says so rather than
 * guessing: a wrong framework guess produces a build command that fails loudly, but a
 * wrong *content* guess silently migrates half a site.
 */

export type Framework =
  | 'astro'
  | 'next'
  | 'nuxt'
  | 'sveltekit'
  | 'eleventy'
  | 'hugo'
  | 'jekyll'
  | 'gatsby'
  | 'vite-spa'
  | 'unknown';

export type ExistingCms =
  'decap' | 'tina' | 'sanity' | 'contentful' | 'strapi' | 'keystatic' | 'none';

export interface RepoFile {
  readonly path: string;
  /** Contents, when the analyser needs to read them. */
  readonly text?: string;
}

export interface Analysis {
  readonly framework: Framework;
  readonly buildCommand: string;
  readonly outputDirectory: string;
  readonly packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'none';
  readonly host: 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages' | 'unknown';
  readonly contentDirectories: readonly string[];
  /** Data modules holding content that no CMS currently manages. */
  readonly hardcodedContent: readonly string[];
  readonly existingCms: ExistingCms;
  readonly locales: readonly LocaleCode[];
  readonly hasSitemap: boolean;
  /** Anything the operator must decide, in plain language. */
  readonly uncertainties: readonly string[];
}

const FRAMEWORK_SIGNATURES: ReadonlyArray<{
  framework: Framework;
  dependency?: string;
  file?: string;
  build: string;
  output: string;
}> = [
  { framework: 'astro', dependency: 'astro', build: 'build', output: 'dist' },
  { framework: 'next', dependency: 'next', build: 'build', output: 'out' },
  { framework: 'nuxt', dependency: 'nuxt', build: 'generate', output: '.output/public' },
  { framework: 'sveltekit', dependency: '@sveltejs/kit', build: 'build', output: 'build' },
  { framework: 'gatsby', dependency: 'gatsby', build: 'build', output: 'public' },
  { framework: 'eleventy', dependency: '@11ty/eleventy', build: 'build', output: '_site' },
  { framework: 'vite-spa', dependency: 'vite', build: 'build', output: 'dist' },
  { framework: 'hugo', file: 'config.toml', build: 'hugo', output: 'public' },
  { framework: 'jekyll', file: '_config.yml', build: 'jekyll build', output: '_site' },
];

const CMS_SIGNATURES: ReadonlyArray<{ cms: ExistingCms; markers: readonly string[] }> = [
  { cms: 'decap', markers: ['decap-cms', 'netlify-cms', 'admin/config.yml'] },
  { cms: 'tina', markers: ['tinacms', 'tina/config'] },
  { cms: 'sanity', markers: ['@sanity/client', 'sanity.config'] },
  { cms: 'contentful', markers: ['contentful'] },
  { cms: 'strapi', markers: ['@strapi/strapi', 'strapi'] },
  { cms: 'keystatic', markers: ['@keystatic/core', 'keystatic.config'] },
];

/** Analyse a cloned repository from its file list and a few key file contents. */
export function analyseRepo(files: readonly RepoFile[]): Analysis {
  const paths = files.map((file) => file.path.replace(/\\/g, '/'));
  const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, '/'), file]));
  const uncertainties: string[] = [];

  const packageJson = readJson(byPath.get('package.json')?.text);
  const dependencies = {
    ...(packageJson?.['dependencies'] as Record<string, string> | undefined),
    ...(packageJson?.['devDependencies'] as Record<string, string> | undefined),
  };
  const scripts = (packageJson?.['scripts'] as Record<string, string> | undefined) ?? {};

  /* ---- framework ---- */

  const signature = FRAMEWORK_SIGNATURES.find(
    (candidate) =>
      (candidate.dependency && dependencies[candidate.dependency]) ||
      (candidate.file && paths.includes(candidate.file)),
  );
  const framework = signature?.framework ?? 'unknown';
  if (framework === 'unknown') {
    uncertainties.push(
      'The framework could not be identified. Set the build command and output directory by hand.',
    );
  }

  /* ---- package manager ---- */

  const packageManager: Analysis['packageManager'] = paths.includes('pnpm-lock.yaml')
    ? 'pnpm'
    : paths.includes('yarn.lock')
      ? 'yarn'
      : paths.includes('bun.lockb')
        ? 'bun'
        : paths.includes('package-lock.json') || packageJson
          ? 'npm'
          : 'none';

  /* ---- build command ---- */

  // The repository's own `build` script wins over the framework default: a target that has
  // customised it has done so for a reason, and overriding that is how a migration breaks
  // a build that was working.
  const buildCommand = scripts['build']
    ? `${packageManager === 'none' ? 'npm' : packageManager} run build`
    : signature
      ? framework === 'hugo' || framework === 'jekyll'
        ? signature.build
        : `${packageManager === 'none' ? 'npm' : packageManager} run ${signature.build}`
      : '';

  if (buildCommand === '') {
    uncertainties.push('No build command was found. The migration cannot verify the build.');
  }

  /* ---- host ---- */

  const host: Analysis['host'] = paths.some((path) => path.startsWith('.github/workflows/'))
    ? 'github-pages'
    : paths.includes('netlify.toml')
      ? 'netlify'
      : paths.includes('vercel.json')
        ? 'vercel'
        : paths.includes('wrangler.toml')
          ? 'cloudflare-pages'
          : 'unknown';

  /* ---- content ---- */

  const contentDirectories = [
    ...new Set(
      paths
        .filter((path) => /\.(md|mdx|markdown)$/i.test(path))
        .map((path) => path.split('/').slice(0, -1).join('/'))
        .filter((directory) => directory !== ''),
    ),
  ].sort();

  /*
   * Content living in code.
   *
   * The brief is explicit that the connector must migrate content that no CMS currently
   * manages -- an array of post objects in a `.js` or `.ts` data module is the usual shape,
   * and it is the content most likely to be forgotten precisely because no CMS knows it
   * exists.
   */
  const hardcodedContent = paths
    .filter((path) => /\.(ts|js|mjs|json)$/i.test(path))
    .filter((path) => /(^|\/)(data|content|posts|articles|_data)\//i.test(path))
    .filter((path) => {
      const text = byPath.get(path)?.text;
      if (!text) return false;
      return looksLikeContentModule(text);
    })
    .sort();

  /* ---- existing CMS ---- */

  const haystack = [...paths, JSON.stringify(dependencies)].join('\n').toLowerCase();
  const existingCms =
    CMS_SIGNATURES.find((candidate) =>
      candidate.markers.some((marker) => haystack.includes(marker.toLowerCase())),
    )?.cms ?? 'none';

  /* ---- locales ---- */

  const locales = LOCALE_CODES.filter((code) =>
    paths.some((path) => new RegExp(`(^|/)${code}(/|\\.)`).test(path)),
  );

  const hasSitemap = paths.some((path) => /sitemap.*\.xml$/i.test(path));
  if (!hasSitemap) {
    uncertainties.push(
      'No sitemap was found, so the before/after route diff is built from the target’s own build output instead.',
    );
  }

  return {
    framework,
    buildCommand,
    outputDirectory: signature?.output ?? 'dist',
    packageManager,
    host,
    contentDirectories,
    hardcodedContent,
    existingCms,
    locales,
    hasSitemap,
    uncertainties,
  };
}

/**
 * Whether a source file looks like it holds content rather than code.
 *
 * Heuristic and deliberately narrow: it wants an array of objects carrying the fields an
 * article has. A false positive migrates a config file into the CMS; a false negative
 * leaves content behind. Both are reported for the operator to check rather than acted on
 * silently.
 */
export function looksLikeContentModule(text: string): boolean {
  const hasArrayOfObjects = /=\s*\[\s*\{/.test(text) || /^\s*\[\s*\{/.test(text);
  if (!hasArrayOfObjects) return false;

  const contentFields = ['title', 'slug', 'body', 'content', 'excerpt', 'date', 'publishedat'];
  const lowered = text.toLowerCase();
  const matches = contentFields.filter((field) => lowered.includes(`${field}:`)).length;

  return matches >= 2;
}

export interface ExtractedItem {
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly source: string;
  readonly frontmatter: Record<string, unknown>;
}

/** Read a Markdown file into the shape the CMS stores. */
export function extractMarkdown(path: string, text: string): ExtractedItem {
  const parsed = parseDocument(text);
  const data = parsed.data;

  const title =
    typeof data['title'] === 'string' && data['title'] !== ''
      ? data['title']
      : (firstHeading(parsed.body) ?? basename(path));

  const slug =
    typeof data['slug'] === 'string' && data['slug'] !== ''
      ? data['slug']
      : slugify(basename(path));

  return { title, slug, body: parsed.body, source: path, frontmatter: data };
}

/**
 * Fields an existing collection actually uses, with how often each appears.
 *
 * This is what the inferred Zod schema is built from. Frequency matters: a field present
 * on every item is required, one present on a third of them is optional, and guessing the
 * other way round makes the schema reject the site's own content.
 */
export function inferFieldUsage(
  items: readonly ExtractedItem[],
): Array<{ field: string; count: number; ratio: number; types: string[] }> {
  const counts = new Map<string, { count: number; types: Set<string> }>();

  for (const item of items) {
    for (const [field, value] of Object.entries(item.frontmatter)) {
      const entry = counts.get(field) ?? { count: 0, types: new Set<string>() };
      entry.count += 1;
      entry.types.add(describeType(value));
      counts.set(field, entry);
    }
  }

  const total = Math.max(1, items.length);
  return [...counts.entries()]
    .map(([field, entry]) => ({
      field,
      count: entry.count,
      ratio: entry.count / total,
      types: [...entry.types].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value === null) return 'null';
  return typeof value;
}

function firstHeading(body: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim();
}

function basename(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.(md|mdx|markdown)$/i, '');
}

function readJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
