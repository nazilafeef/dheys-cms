import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content collections.
 *
 * Note what is *not* here: a schema.
 *
 * Astro's `defineCollection` accepts a Zod schema, but Astro bundles its own copy of Zod.
 * Handing it a schema built with this project's Zod means two instances validating the
 * same data, and the two disagree at the edges. The alternative — restating every schema
 * here using Astro's re-exported `z` — would give this CMS two definitions of a post that
 * drift apart the first time either is edited.
 *
 * So the collections are loaded unvalidated, and `src/lib/content.ts` runs every entry
 * through the single authoritative schema in `src/lib/schemas.ts`, failing the build with
 * the file path and the field name when something is wrong. One schema, one error message,
 * and the error message is one this project wrote rather than one Zod generated.
 */

/**
 * Entry ids keep their directory.
 *
 * The loader's default id is the file's basename, so `posts/en/about.md` and
 * `posts/dv/about.md` both become `about` and the second silently overwrites the first.
 * For a CMS whose whole point is the same article in several languages, that is not an
 * edge case — it is the normal shape of the content directory.
 */
const localeAwareId = ({ entry }: { entry: string }): string => entry.replace(/\.(md|mdx)$/, '');

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/posts',
    generateId: localeAwareId,
  }),
});

const pages = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/pages',
    generateId: localeAwareId,
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/authors' }),
});

const categories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/categories' }),
});

export const collections = { posts, pages, authors, categories };
