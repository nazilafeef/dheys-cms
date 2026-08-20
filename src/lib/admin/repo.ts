import { type GitHubClient, GitHubError } from '../github';
import { parseDocument, serialiseDocument } from '../frontmatter';
import { postSchema, toFieldErrors, type FieldError, type Post } from '../schemas';
import { transition, type StatefulItem } from '../editorial';
import { uniqueSlug } from '../slug';
import type { SiteDefinition } from '../site-registry';
import type { Actor, EditorialState } from '../schemas';
import type { LocaleCode } from '../i18n';

/**
 * Reading and writing a connected site's content from the admin.
 *
 * Everything the editor does goes through here, and everything here is a commit. There is
 * no draft store, no autosave buffer and no local database: an edit either reached the
 * repository or it did not, and the difference is visible in git rather than inferred from
 * a spinner.
 *
 * The blob sha is carried on every load and handed back on every save. Dropping it is how
 * a CMS silently overwrites a colleague's edit; keeping it makes GitHub return 409 and the
 * editor tell the operator to reload, which is the correct outcome.
 */

export interface ContentFile {
  readonly path: string;
  readonly item: Post;
  readonly body: string;
  /** Blob sha of the version that was read. Required to write it back safely. */
  readonly sha: string;
}

export interface LoadProblem {
  readonly path: string;
  readonly errors: readonly FieldError[];
}

export interface ContentListing {
  readonly files: readonly ContentFile[];
  /**
   * Files that exist but do not validate.
   *
   * Surfaced rather than skipped: an item the admin silently hides is an item an editor
   * cannot find or fix, and a hand-edited or imported file is exactly where this happens.
   */
  readonly problems: readonly LoadProblem[];
}

function postsDirectory(site: SiteDefinition, locale: LocaleCode): string {
  return `${site.contentDir}/posts/${locale}`;
}

/** Read every post in a locale. */
export async function listContent(
  client: GitHubClient,
  site: SiteDefinition,
  locale: LocaleCode,
): Promise<ContentListing> {
  const files: ContentFile[] = [];
  const problems: LoadProblem[] = [];

  let entries;
  try {
    entries = await client.listDirectory(
      site.repo.owner,
      site.repo.name,
      postsDirectory(site, locale),
      site.repo.branch,
    );
  } catch (error) {
    // A locale directory that does not exist yet is an empty list, not a failure.
    if (error instanceof GitHubError && error.status === 404) return { files: [], problems: [] };
    throw error;
  }

  for (const entry of entries) {
    if (entry.type !== 'file' || !/\.mdx?$/.test(entry.name)) continue;

    const { text, sha } = await client.getFile(
      site.repo.owner,
      site.repo.name,
      entry.path,
      site.repo.branch,
    );

    let document;
    try {
      document = parseDocument(text);
    } catch (error) {
      problems.push({
        path: entry.path,
        errors: [
          { field: '(file)', message: error instanceof Error ? error.message : String(error) },
        ],
      });
      continue;
    }

    const parsed = postSchema.safeParse(document.data);
    if (!parsed.success) {
      problems.push({ path: entry.path, errors: toFieldErrors(parsed.error) });
      continue;
    }

    files.push({ path: entry.path, item: parsed.data, body: document.body, sha });
  }

  return { files, problems };
}

/** Read one post. */
export async function loadContent(
  client: GitHubClient,
  site: SiteDefinition,
  path: string,
): Promise<ContentFile> {
  const { text, sha } = await client.getFile(
    site.repo.owner,
    site.repo.name,
    path,
    site.repo.branch,
  );
  const document = parseDocument(text);
  const parsed = postSchema.safeParse(document.data);

  if (!parsed.success) {
    const detail = toFieldErrors(parsed.error)
      .map((error) => `${error.field}: ${error.message}`)
      .join('; ');
    throw new Error(`${path} does not validate — ${detail}`);
  }

  return { path, item: parsed.data, body: document.body, sha };
}

export interface SaveResult {
  readonly path: string;
  readonly sha: string;
}

/**
 * Write a post back.
 *
 * Validated before it is sent, so the admin cannot commit an item the build would reject:
 * an editor discovering their mistake in a failed CI run twenty minutes later is a much
 * worse experience than being told which field is wrong while they are still looking at it.
 */
export async function saveContent(
  client: GitHubClient,
  site: SiteDefinition,
  file: ContentFile,
  options: { message: string; actor: Actor },
): Promise<SaveResult | { errors: readonly FieldError[] }> {
  const parsed = postSchema.safeParse(file.item);
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const contents = serialiseDocument(frontmatterOf(parsed.data), file.body);

  const result = await client.putFile({
    owner: site.repo.owner,
    repo: site.repo.name,
    path: file.path,
    branch: site.repo.branch,
    message: options.message,
    content: contents,
    ...(file.sha ? { sha: file.sha } : {}),
  });

  return { path: file.path, sha: result.content?.sha ?? '' };
}

/**
 * Move an item through the editorial machine and commit the result.
 *
 * The transition and the commit are one operation on purpose: a state change that is not
 * in git is a state change that does not survive a reload, and the git history *is* the
 * audit trail this system promises.
 */
export async function transitionAndCommit(
  client: GitHubClient,
  site: SiteDefinition,
  file: ContentFile,
  to: EditorialState,
  actor: Actor,
  options: { note?: string; now: Date },
): Promise<SaveResult | { errors: readonly FieldError[] }> {
  const moved = transition(file.item as StatefulItem & Post, to, actor, {
    at: options.now,
    ...(options.note === undefined ? {} : { note: options.note }),
  });

  return saveContent(
    client,
    site,
    { ...file, item: moved as Post },
    {
      message: commitMessageFor(moved as Post, to, actor, options.note),
      actor,
    },
  );
}

function commitMessageFor(
  item: Post,
  to: EditorialState,
  actor: Actor,
  note: string | undefined,
): string {
  const lines = [`${to}: ${item.title}`, '', `Moved to "${to}" by ${actor.kind}:${actor.id}.`];
  if (note) lines.push('', note);
  return lines.join('\n');
}

/** Frontmatter in a stable key order, so a save produces a minimal diff. */
function frontmatterOf(item: Post): Record<string, unknown> {
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

/**
 * A slug that does not collide with anything already in the locale.
 *
 * Collision detection has to be against the repository rather than against what the editor
 * happens to have loaded: two people drafting at once will both see "available" otherwise,
 * and the second save silently overwrites the first.
 */
export function availableSlug(desired: string, taken: readonly string[]): string {
  return uniqueSlug(desired, taken);
}

/** Path a new item will be written to. */
export function pathFor(site: SiteDefinition, locale: LocaleCode, slug: string): string {
  return `${postsDirectory(site, locale)}/${slug}.md`;
}
