import { serialiseDocument } from './frontmatter';
import type { ContentAdapterConfig } from './site-registry';
import type { Post } from './schemas';

/**
 * Content adapters.
 *
 * The CMS is the source of truth in Markdown + frontmatter. A connected site need not be
 * Astro and need not consume Markdown, so an adapter *projects* the truth into whatever
 * the target actually reads at build time. Nothing here is a migration: projection runs
 * on every publish, and the CMS copy stays authoritative.
 *
 * The JSON adapter is the one with a sharp edge. It emits a **complete, parseable JSON
 * document** -- a top-level array, opening bracket to closing bracket. It must never emit
 * a brace-less fragment that a consumer has to wrap on read, because the moment a build
 * step re-wraps a fragment, a module doing `import posts from './posts.json' with { type:
 * 'json' }` gets a syntax error at parse time with no useful location. The unit tests
 * assert `JSON.parse` succeeds and yields an array, which is the property that matters.
 */

export interface ProjectableItem {
  readonly item: Post;
  /** Markdown body, without frontmatter. */
  readonly body: string;
}

export interface ProjectedFile {
  readonly path: string;
  readonly contents: string;
}

export interface ProjectionResult {
  readonly files: readonly ProjectedFile[];
  /** Anything the operator should know about what was and was not projected. */
  readonly notes: readonly string[];
  /** Commands the target must run after the files land, in order. */
  readonly commands: readonly string[];
}

export interface ProjectionOptions {
  /** Used to exclude future-dated items. Injected so the result is deterministic. */
  readonly now: Date;
  /** Include drafts. Off in every real publish; on for preview builds. */
  readonly includeDrafts?: boolean;
}

/**
 * Items that may appear in built output.
 *
 * Two exclusions, both of which are silent data leaks if missed: a draft is work in
 * progress and must not reach a public build, and a future-dated item is scheduled --
 * emitting it early publishes it early, which defeats the entire scheduler.
 */
export function publishableItems(
  items: readonly ProjectableItem[],
  options: ProjectionOptions,
): ProjectableItem[] {
  return items.filter(({ item }) => {
    if (item.draft && options.includeDrafts !== true) return false;
    if (item.state === 'rejected') return false;
    if (item.publishedDate.getTime() > options.now.getTime()) return false;
    return true;
  });
}

/** Plain, JSON-safe record for adapters that do not consume Markdown files. */
export interface ContentRecord {
  readonly title: string;
  readonly slug: string;
  readonly category: string;
  readonly publishedDate: string;
  readonly updatedDate?: string;
  readonly excerpt: string;
  readonly locale: string;
  readonly author: string;
  readonly sourceType: string;
  readonly tags: readonly string[];
  readonly featured: boolean;
  readonly pinned: boolean;
  readonly heroImage?: string;
  readonly heroImageAlt?: string;
  readonly series?: string;
  readonly seriesIndex?: number;
  readonly canonical?: string;
  readonly noindex: boolean;
  readonly attribution?: string;
  readonly affiliateDisclosure?: string;
  readonly body?: string;
}

/** Project one item to a JSON-safe record. Dates become ISO strings, never Date objects. */
export function toRecord(
  { item, body }: ProjectableItem,
  options: { includeBody: boolean },
): ContentRecord {
  const attribution =
    item.provenance && (item.sourceType === 'ai' || item.sourceType === 'ai-assisted')
      ? item.provenance.reviewedBy
        ? `Written by ${item.provenance.model}, reviewed by ${item.provenance.reviewedBy}`
        : `Written by ${item.provenance.model}`
      : undefined;

  return {
    title: item.title,
    slug: item.slug,
    category: item.category,
    publishedDate: item.publishedDate.toISOString(),
    ...(item.updatedDate ? { updatedDate: item.updatedDate.toISOString() } : {}),
    excerpt: item.excerpt,
    locale: item.locale,
    author: item.author,
    sourceType: item.sourceType,
    tags: [...item.tags],
    featured: item.featured,
    pinned: item.pinned,
    ...(item.heroImage ? { heroImage: item.heroImage } : {}),
    ...(item.heroImageAlt ? { heroImageAlt: item.heroImageAlt } : {}),
    ...(item.series ? { series: item.series } : {}),
    ...(item.seriesIndex ? { seriesIndex: item.seriesIndex } : {}),
    ...(item.seo.canonical ? { canonical: item.seo.canonical } : {}),
    noindex: item.seo.noindex,
    ...(attribution ? { attribution } : {}),
    ...(item.affiliate.hasOffers && item.affiliate.disclosure
      ? { affiliateDisclosure: item.affiliate.disclosure }
      : {}),
    ...(options.includeBody ? { body } : {}),
  };
}

/** Frontmatter as it is written to a Markdown file. Order is the file's key order. */
function toFrontmatter(item: Post): Record<string, unknown> {
  return {
    title: item.title,
    slug: item.slug,
    category: item.category,
    publishedDate: item.publishedDate,
    ...(item.updatedDate ? { updatedDate: item.updatedDate } : {}),
    excerpt: item.excerpt,
    locale: item.locale,
    author: item.author,
    sourceType: item.sourceType,
    tags: item.tags,
    ...(item.series ? { series: item.series } : {}),
    ...(item.seriesIndex ? { seriesIndex: item.seriesIndex } : {}),
    draft: item.draft,
    featured: item.featured,
    pinned: item.pinned,
    ...(item.heroImage ? { heroImage: item.heroImage } : {}),
    ...(item.heroImageAlt ? { heroImageAlt: item.heroImageAlt } : {}),
    seo: item.seo,
    state: item.state,
    approvalPolicy: item.approvalPolicy,
    ...(item.schedule ? { schedule: item.schedule } : {}),
    transitions: item.transitions,
    ...(item.provenance ? { provenance: item.provenance } : {}),
    affiliate: item.affiliate,
    ...(item.translationOf ? { translationOf: item.translationOf } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The adapters
 * ------------------------------------------------------------------ */

export const CONTENT_ADAPTER_IDS = ['collections', 'json', 'js-module', 'generic'] as const;
export type ContentAdapterId = (typeof CONTENT_ADAPTER_IDS)[number];

/**
 * Project items for a site. Dispatches on the site's configured adapter; every branch
 * returns the same result shape so the scheduler does not care which target it is
 * writing to.
 */
export function project(
  config: ContentAdapterConfig,
  items: readonly ProjectableItem[],
  options: ProjectionOptions,
): ProjectionResult {
  const publishable = publishableItems(items, options);
  const excluded = items.length - publishable.length;
  const baseNotes =
    excluded > 0
      ? [
          `${excluded} item(s) withheld: drafts, rejected items and future-dated items are not projected.`,
        ]
      : [];

  switch (config.kind) {
    case 'collections':
      return projectCollections(config, publishable, baseNotes);
    case 'json':
      return projectJson(config, publishable, baseNotes);
    case 'js-module':
      return projectJsModule(config, publishable, baseNotes);
    case 'generic':
      return projectGeneric(config, publishable, baseNotes);
  }
}

/**
 * Astro / Next content collections. The target already consumes Markdown with
 * frontmatter, so this is a direct write with no transform at all -- which is the point:
 * the least machinery between the CMS and a target that speaks the same format.
 */
function projectCollections(
  config: Extract<ContentAdapterConfig, { kind: 'collections' }>,
  items: readonly ProjectableItem[],
  notes: readonly string[],
): ProjectionResult {
  const files = items.map((entry) => ({
    path: `${trimSlashes(config.directory)}/${entry.item.locale}/${entry.item.slug}.${config.extension}`,
    contents: serialiseDocument(toFrontmatter(entry.item), entry.body),
  }));
  return { files, notes: [...notes], commands: [] };
}

/**
 * A JSON-consuming SPA. Emits one complete JSON document containing a top-level array.
 *
 * `JSON.stringify` on the whole array is the only correct way to build this: concatenating
 * per-item JSON and hoping the commas line up is how fragments get shipped.
 */
function projectJson(
  config: Extract<ContentAdapterConfig, { kind: 'json' }>,
  items: readonly ProjectableItem[],
  notes: readonly string[],
): ProjectionResult {
  const records = items.map((entry) => toRecord(entry, { includeBody: config.includeBody }));
  const contents = `${JSON.stringify(records, null, 2)}\n`;
  return {
    files: [{ path: trimSlashes(config.outputPath), contents }],
    notes: [
      ...notes,
      `Wrote ${records.length} record(s) as a complete JSON array. A consumer can import it directly with \`with { type: 'json' }\`.`,
    ],
    commands: [],
  };
}

/**
 * A JavaScript data module. Same records, but as a real ES module so a target that wants
 * to add derived fields or types can import and extend it without a JSON loader.
 */
function projectJsModule(
  config: Extract<ContentAdapterConfig, { kind: 'js-module' }>,
  items: readonly ProjectableItem[],
  notes: readonly string[],
): ProjectionResult {
  const records = items.map((entry) => toRecord(entry, { includeBody: true }));
  const name = config.exportName;
  const contents = [
    '// Generated by Dheys CMS. Do not edit by hand -- changes are overwritten on publish.',
    `// ${records.length} item(s).`,
    '',
    `export const ${name} = ${JSON.stringify(records, null, 2)};`,
    '',
    `export default ${name};`,
    '',
  ].join('\n');

  return {
    files: [{ path: trimSlashes(config.outputPath), contents }],
    notes: [...notes, `Wrote ${records.length} record(s) as \`export const ${name}\`.`],
    commands: [],
  };
}

/**
 * Anything else. Writes Markdown to a directory and hands back the operator's transform
 * command for the runner to execute after the files land.
 */
function projectGeneric(
  config: Extract<ContentAdapterConfig, { kind: 'generic' }>,
  items: readonly ProjectableItem[],
  notes: readonly string[],
): ProjectionResult {
  const files = items.map((entry) => ({
    path: `${trimSlashes(config.directory)}/${entry.item.locale}/${entry.item.slug}.md`,
    contents: serialiseDocument(toFrontmatter(entry.item), entry.body),
  }));

  const commands = config.transformCommand ? [config.transformCommand] : [];
  const extraNotes = config.transformCommand
    ? []
    : ['No transformCommand is configured, so the Markdown is written and nothing else runs.'];

  return { files, notes: [...notes, ...extraNotes], commands };
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}
