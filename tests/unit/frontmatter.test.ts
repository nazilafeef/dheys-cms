import { describe, it, expect } from 'vitest';
import { parseDocument, serialiseDocument, replaceBody, patchFrontmatter } from '@lib/frontmatter';
import { postSchema } from '@lib/schemas';
import { dhivehiPostInput, sampleProvenance, SAMPLE_BODY } from '../fixtures/items';

describe('parseDocument', () => {
  it('splits frontmatter from body', () => {
    const raw = ['---', 'title: Hello', 'draft: false', '---', '', 'Body text.', ''].join('\n');
    const parsed = parseDocument(raw);
    expect(parsed.hadFrontmatter).toBe(true);
    expect(parsed.data['title']).toBe('Hello');
    expect(parsed.data['draft']).toBe(false);
    expect(parsed.body.trim()).toBe('Body text.');
  });

  it('treats a document with no frontmatter as a body with no data', () => {
    const parsed = parseDocument('# Just markdown\n\nNo fence here.\n');
    expect(parsed.hadFrontmatter).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toContain('Just markdown');
  });

  it('tolerates CRLF, which is what a Windows editor writes', () => {
    const raw = '---\r\ntitle: Hello\r\n---\r\n\r\nBody.\r\n';
    expect(parseDocument(raw).data['title']).toBe('Hello');
  });

  it('refuses an unterminated fence rather than swallowing the file', () => {
    expect(() => parseDocument('---\ntitle: Hello\n\nBody with no closing fence.\n')).toThrow(
      /never closed/,
    );
  });

  it('reports invalid YAML as invalid YAML', () => {
    expect(() => parseDocument('---\ntitle: "unclosed\n---\n\nBody\n')).toThrow(/not valid YAML/);
  });

  it('refuses frontmatter that is a list rather than a mapping', () => {
    expect(() => parseDocument('---\n- one\n- two\n---\n\nBody\n')).toThrow(/mapping/);
  });

  it('reads an empty frontmatter block as no data', () => {
    const parsed = parseDocument('---\n---\n\nBody\n');
    expect(parsed.data).toEqual({});
    expect(parsed.hadFrontmatter).toBe(true);
  });
});

describe('serialiseDocument', () => {
  it('emits dates as ISO strings, not YAML timestamps', () => {
    const output = serialiseDocument({ publishedDate: new Date('2026-03-04T09:00:00.000Z') }, 'x');
    expect(output).toContain('"2026-03-04T09:00:00.000Z"');
  });

  it('drops undefined keys but keeps null ones', () => {
    const output = serialiseDocument({ a: undefined, b: null, c: 1 }, 'x');
    expect(output).not.toContain('a:');
    expect(output).toContain('b:');
    expect(output).toContain('c: 1');
  });

  it('never folds a long line, so Thaana strings stay readable and diff cleanly', () => {
    const long = 'ދިވެހި '.repeat(40).trim();
    const output = serialiseDocument({ excerpt: long }, 'body');
    const excerptLine = output.split('\n').find((line) => line.startsWith('excerpt:'));
    expect(excerptLine).toContain(long);
  });
});

describe('round-trip', () => {
  it('preserves a full item through serialise → parse', () => {
    const item = postSchema.parse({
      ...dhivehiPostInput(),
      sourceType: 'ai',
      provenance: sampleProvenance(),
      tags: ['dhiyavaru', 'bandharu'],
      affiliate: { hasOffers: false },
    });

    const document = serialiseDocument(
      {
        title: item.title,
        slug: item.slug,
        category: item.category,
        publishedDate: item.publishedDate,
        excerpt: item.excerpt,
        locale: item.locale,
        author: item.author,
        sourceType: item.sourceType,
        tags: item.tags,
        provenance: item.provenance,
      },
      SAMPLE_BODY,
    );

    const parsed = parseDocument(document);
    expect(parsed.data['title']).toBe(item.title);
    expect(parsed.data['excerpt']).toBe(item.excerpt);
    expect(parsed.data['locale']).toBe('dv');
    expect(parsed.data['tags']).toEqual(['dhiyavaru', 'bandharu']);
    expect(parsed.body.trim()).toBe(SAMPLE_BODY.trim());

    // Re-validating the parsed frontmatter must produce the same item, which is what a
    // translate or rewrite job relies on when it reads a document back.
    const revalidated = postSchema.parse(parsed.data);
    expect(revalidated.publishedDate.toISOString()).toBe(item.publishedDate.toISOString());
    expect(revalidated.provenance?.runId).toBe(item.provenance?.runId);
    expect(revalidated.provenance?.costUsd).toBe(item.provenance?.costUsd);
  });

  it('is stable — serialising twice produces identical bytes', () => {
    const data = {
      title: 'ބަނދަރުގެ ދިޔަވަރު',
      publishedDate: new Date('2026-03-04T09:00:00.000Z'),
      tags: ['a', 'b'],
      nested: { deep: { value: 1 } },
    };
    const once = serialiseDocument(data, SAMPLE_BODY);
    const twice = serialiseDocument(parseDocument(once).data, parseDocument(once).body);
    expect(twice).toBe(once);
  });

  it('preserves Thaana punctuation exactly', () => {
    const excerpt = 'ސަތޭކަ އަހަރު، އަދި އެއިން ދޭހަވަނީ ކޮންކަމެއްތޯ؟';
    const output = serialiseDocument({ excerpt }, 'body');
    expect(parseDocument(output).data['excerpt']).toBe(excerpt);
  });
});

describe('replaceBody', () => {
  it('rewrites prose without touching a byte of frontmatter', () => {
    const original = ['---', 'title: Hello', 'runId: run-7', '---', '', 'Old prose.', ''].join(
      '\n',
    );
    const updated = replaceBody(original, 'New prose.');
    expect(updated).toContain('title: Hello');
    expect(updated).toContain('runId: run-7');
    expect(updated).toContain('New prose.');
    expect(updated).not.toContain('Old prose.');
    // The frontmatter block is byte-identical, so a rewrite job cannot disturb provenance.
    expect(updated.split('---')[1]).toBe(original.split('---')[1]);
  });
});

describe('patchFrontmatter', () => {
  it('merges keys and leaves the body alone', () => {
    const original = ['---', 'title: Hello', 'state: draft', '---', '', 'Prose.', ''].join('\n');
    const updated = patchFrontmatter(original, { state: 'in-review' });
    expect(parseDocument(updated).data['state']).toBe('in-review');
    expect(parseDocument(updated).data['title']).toBe('Hello');
    expect(parseDocument(updated).body.trim()).toBe('Prose.');
  });
});
