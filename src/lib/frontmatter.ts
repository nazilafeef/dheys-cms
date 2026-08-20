import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Markdown documents with YAML frontmatter.
 *
 * This is the CMS's storage format everywhere: what an agent produces, what the admin
 * commits, what the scheduler publishes, and what a `ContentAdapter` reads before
 * projecting it into whatever a target site actually consumes.
 *
 * Two things it must never do, both learned from the failure modes the brief names:
 *
 *  - It must not emit a JSON *fragment*. Content adapters that produce JSON build a
 *    complete, parseable document; nothing here ever writes brace-less JSON that a
 *    consumer has to re-wrap on read.
 *  - It must round-trip. A translate job reads a document, replaces prose, and writes it
 *    back; if a date became a string of a different shape, or a nested object lost its
 *    key order, or a Thaana string got re-encoded, the diff would be full of noise and
 *    the provenance would drift. `parseDocument(serialiseDocument(x)) === x` is a test,
 *    not an aspiration.
 */

const FENCE = '---';

export interface ParsedDocument {
  readonly data: Record<string, unknown>;
  readonly body: string;
  /** True when the source actually carried a frontmatter block. */
  readonly hadFrontmatter: boolean;
}

/**
 * Split a document into frontmatter and body. A file with no frontmatter is not an
 * error -- it is a body with no data, which is what a plain Markdown import looks like.
 */
export function parseDocument(raw: string): ParsedDocument {
  const normalised = raw.replace(/^\uFEFF/, '');
  const lines = normalised.split(/\r?\n/);

  if (lines[0]?.trim() !== FENCE) {
    return { data: {}, body: normalised, hadFrontmatter: false };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FENCE) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    // An unterminated fence is a malformed document, not a body that happens to start
    // with three dashes. Say so rather than silently swallowing the whole file.
    throw new Error(
      'Frontmatter block was opened with "---" but never closed. Add a closing "---" line.',
    );
  }

  const yamlSource = lines.slice(1, closingIndex).join('\n');
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n/, '');

  let data: unknown;
  try {
    data = yamlSource.trim() === '' ? {} : parseYaml(yamlSource);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Frontmatter is not valid YAML: ${detail}`);
  }

  if (data === null || data === undefined) return { data: {}, body, hadFrontmatter: true };
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Frontmatter must be a mapping of keys to values, not a scalar or a list.');
  }

  return { data: data as Record<string, unknown>, body, hadFrontmatter: true };
}

/**
 * Write a document. Keys are emitted in insertion order so a round-trip produces a
 * minimal diff, and dates are emitted as ISO 8601 strings rather than YAML timestamps --
 * YAML's native date type is parsed differently by different loaders, and a site build
 * that reads `publishedDate` as a string in one tool and a Date in another is exactly
 * the kind of quiet inconsistency this format exists to avoid.
 */
export function serialiseDocument(data: Record<string, unknown>, body: string): string {
  const prepared = prepareForYaml(data);
  const yamlSource = stringifyYaml(prepared, {
    lineWidth: 0, // never fold; a wrapped Thaana string is unreadable and diffs badly
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
    nullStr: '',
  }).trimEnd();

  const trimmedBody = body.replace(/^\n+/, '').trimEnd();
  return `${FENCE}\n${yamlSource}\n${FENCE}\n\n${trimmedBody}\n`;
}

/** Recursively convert values YAML cannot represent losslessly. */
function prepareForYaml(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(prepareForYaml);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue; // an absent key, not a null one
      out[key] = prepareForYaml(item);
    }
    return out;
  }
  return value;
}

/**
 * Replace only the body of a document, leaving frontmatter byte-identical.
 * This is what a rewrite job uses, so a prose change never disturbs provenance.
 */
export function replaceBody(raw: string, newBody: string): string {
  const parsed = parseDocument(raw);
  if (!parsed.hadFrontmatter) return `${newBody.trimEnd()}\n`;
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FENCE) {
      closingIndex = index;
      break;
    }
  }
  const head = lines.slice(0, closingIndex + 1).join('\n');
  return `${head}\n\n${newBody.replace(/^\n+/, '').trimEnd()}\n`;
}

/**
 * Merge frontmatter changes without touching the body. Used by state transitions, which
 * must record an actor and a timestamp without rewriting a single character of prose.
 */
export function patchFrontmatter(raw: string, patch: Record<string, unknown>): string {
  const parsed = parseDocument(raw);
  return serialiseDocument({ ...parsed.data, ...patch }, parsed.body);
}
