import { describe, it, expect } from 'vitest';
import {
  normalisePath,
  routesFromFiles,
  routesFromSitemap,
  diffRoutes,
  formatRouteDiff,
} from '@lib/connector/routes';
import {
  analyseRepo,
  looksLikeContentModule,
  extractMarkdown,
  inferFieldUsage,
  type RepoFile,
} from '@lib/connector/analyse';

/**
 * The connector.
 *
 * The route diff is the load-bearing part and gets the most attention: a migration that
 * loses a URL is the one failure that is both irreversible in practice and invisible for
 * weeks. The brief asks specifically for a test that catches a deliberately dropped URL,
 * which is the first case below.
 */

describe('path normalisation', () => {
  it.each([
    ['/about', '/about'],
    ['/about/', '/about'],
    ['/about/index.html', '/about'],
    ['/About', '/about'],
    ['about', '/about'],
    ['//about//', '/about'],
    ['/about?utm=x', '/about'],
    ['/about#section', '/about'],
    ['/a%20b', '/a b'],
    ['https://example.com/about/', '/about'],
    ['/', '/'],
    ['/index.html', '/'],
  ])('%j -> %j', (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });

  it('does not throw on a malformed escape', () => {
    expect(() => normalisePath('/a%ZZ')).not.toThrow();
  });
});

describe('the route diff catches a dropped URL', () => {
  it('FAILS when a page that existed before no longer resolves', () => {
    const before = {
      paths: ['/', '/about', '/articles/the-tide-gauge', '/articles/reading-the-monsoon'],
    };
    // The migration quietly dropped one article.
    const after = { paths: ['/', '/about', '/articles/the-tide-gauge'] };

    const diff = diffRoutes(before, after);

    expect(diff.safe).toBe(false);
    expect(diff.lost).toEqual(['/articles/reading-the-monsoon']);
    expect(formatRouteDiff(diff)).toMatch(/Route diff: FAILED/);
    expect(formatRouteDiff(diff)).toMatch(/may not lose a URL/);
  });

  it('passes when every previous URL still resolves', () => {
    const before = { paths: ['/', '/about'] };
    const after = { paths: ['/', '/about'] };

    const diff = diffRoutes(before, after);
    expect(diff.safe).toBe(true);
    expect(diff.lost).toEqual([]);
    expect(diff.kept).toEqual(['/', '/about']);
  });

  it('treats a redirect as coverage', () => {
    const before = { paths: ['/', '/old-post'] };
    const after = {
      paths: ['/', '/articles/new-post'],
      redirects: { '/old-post': '/articles/new-post' },
    };

    const diff = diffRoutes(before, after);
    expect(diff.safe).toBe(true);
    expect(diff.redirected).toEqual([{ from: '/old-post', to: '/articles/new-post' }]);
  });

  it('refuses a redirect that points at nothing', () => {
    // A redirect to a 404 is a 404 with extra steps, and is exactly what a careless check
    // waves through.
    const before = { paths: ['/', '/old-post'] };
    const after = { paths: ['/'], redirects: { '/old-post': '/articles/never-created' } };

    const diff = diffRoutes(before, after);
    expect(diff.safe).toBe(false);
    expect(diff.lost).toEqual(['/old-post']);
  });

  it('welcomes new pages rather than treating them as drift', () => {
    const before = { paths: ['/'] };
    const after = { paths: ['/', '/articles/brand-new'] };

    const diff = diffRoutes(before, after);
    expect(diff.safe).toBe(true);
    expect(diff.added).toEqual(['/articles/brand-new']);
  });

  it('is not fooled by trailing slashes or index files changing shape', () => {
    // The commonest false alarm: a framework that emitted `/about/index.html` now emits
    // `/about.html`. Same URL to a reader.
    const before = { paths: ['/about/index.html'] };
    const after = { paths: ['/about.html'] };

    expect(diffRoutes(before, after).safe).toBe(true);
  });

  it('reports every lost URL, not just the first', () => {
    const before = { paths: ['/a', '/b', '/c'] };
    const after = { paths: ['/a'] };
    expect(diffRoutes(before, after).lost).toEqual(['/b', '/c']);
  });
});

describe('reading routes from build output', () => {
  it('takes routes from the HTML a build emitted', () => {
    const files = [
      'index.html',
      'about/index.html',
      'articles/the-tide-gauge/index.html',
      'assets/style.css',
      'favicon.svg',
    ];
    expect(routesFromFiles(files)).toEqual(['/', '/about', '/articles/the-tide-gauge']);
  });

  it('ignores anything that is not a document', () => {
    expect(routesFromFiles(['assets/app.js', 'image.png'])).toEqual([]);
  });
});

describe('reading routes from a sitemap', () => {
  it('extracts every loc', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about/</loc></url>
    </urlset>`;
    expect(routesFromSitemap(xml)).toEqual(['/', '/about']);
  });

  it('survives a sitemap that is not well-formed', () => {
    // Somebody else's sitemap, with a bare ampersand. A strict parser would throw and
    // abandon the migration over it.
    const xml = '<urlset><url><loc>https://example.com/a&b</loc></url><url><loc>/c</loc>';
    expect(() => routesFromSitemap(xml)).not.toThrow();
    expect(routesFromSitemap(xml)).toContain('/c');
  });
});

/* ------------------------------------------------------------------ */

function repo(files: Record<string, string | undefined>): RepoFile[] {
  return Object.entries(files).map(([path, text]) => ({
    path,
    ...(text === undefined ? {} : { text }),
  }));
}

describe('analysing a target repository', () => {
  it('identifies an Astro site and its build command', () => {
    const analysis = analyseRepo(
      repo({
        'package.json': JSON.stringify({
          dependencies: { astro: '^5.0.0' },
          scripts: { build: 'astro build' },
        }),
        'pnpm-lock.yaml': '',
        'src/content/posts/one.md': '---\ntitle: One\n---\n',
      }),
    );

    expect(analysis.framework).toBe('astro');
    expect(analysis.packageManager).toBe('pnpm');
    expect(analysis.buildCommand).toBe('pnpm run build');
    expect(analysis.outputDirectory).toBe('dist');
  });

  it("prefers the repository's own build script over a framework default", () => {
    // A target that customised its build did so for a reason.
    const analysis = analyseRepo(
      repo({
        'package.json': JSON.stringify({
          dependencies: { next: '^15.0.0' },
          scripts: { build: 'next build && next export && ./scripts/post.sh' },
        }),
        'package-lock.json': '',
      }),
    );
    expect(analysis.buildCommand).toBe('npm run build');
  });

  it('identifies a Jekyll site with no package.json at all', () => {
    const analysis = analyseRepo(
      repo({ '_config.yml': 'title: A site', '_posts/a.md': '---\n---\n' }),
    );
    expect(analysis.framework).toBe('jekyll');
    expect(analysis.buildCommand).toBe('jekyll build');
    expect(analysis.outputDirectory).toBe('_site');
  });

  it('says plainly when it cannot tell', () => {
    const analysis = analyseRepo(repo({ 'readme.txt': 'hello' }));
    expect(analysis.framework).toBe('unknown');
    expect(analysis.uncertainties.join(' ')).toMatch(/framework could not be identified/);
  });

  it('detects an existing CMS', () => {
    const analysis = analyseRepo(
      repo({
        'package.json': JSON.stringify({ dependencies: { astro: '^5', tinacms: '^2' } }),
      }),
    );
    expect(analysis.existingCms).toBe('tina');
  });

  it('detects the host from its configuration file', () => {
    expect(analyseRepo(repo({ 'netlify.toml': '' })).host).toBe('netlify');
    expect(analyseRepo(repo({ 'vercel.json': '{}' })).host).toBe('vercel');
    expect(analyseRepo(repo({ '.github/workflows/deploy.yml': '' })).host).toBe('github-pages');
  });

  it('finds the locales a site is already published in', () => {
    const analysis = analyseRepo(
      repo({ 'content/en/a.md': '', 'content/dv/a.md': '', 'content/ar/a.md': '' }),
    );
    expect([...analysis.locales].sort()).toEqual(['ar', 'dv', 'en']);
  });

  it('notes the absence of a sitemap rather than assuming one', () => {
    expect(analyseRepo(repo({ 'index.html': '' })).hasSitemap).toBe(false);
    expect(analyseRepo(repo({ 'sitemap.xml': '' })).hasSitemap).toBe(true);
  });
});

describe('content that no CMS manages', () => {
  it('recognises an array of post objects in a data module', () => {
    const source = `
      export const posts = [
        { title: 'One', slug: 'one', body: 'First.' },
        { title: 'Two', slug: 'two', body: 'Second.' },
      ];
    `;
    expect(looksLikeContentModule(source)).toBe(true);
  });

  it('does not mistake a configuration array for content', () => {
    const source = `export const nav = [{ href: '/', label: 'Home' }];`;
    expect(looksLikeContentModule(source)).toBe(false);
  });

  it('finds hardcoded content the migration would otherwise leave behind', () => {
    const analysis = analyseRepo(
      repo({
        'package.json': JSON.stringify({ dependencies: { astro: '^5' } }),
        'src/data/posts.ts':
          "export const posts = [{ title: 'One', slug: 'one', excerpt: 'x', body: 'y' }];",
        'src/data/nav.ts': "export const nav = [{ href: '/', label: 'Home' }];",
      }),
    );

    expect(analysis.hardcodedContent).toEqual(['src/data/posts.ts']);
  });
});

describe('reading existing Markdown', () => {
  it('keeps the frontmatter it finds', () => {
    const item = extractMarkdown(
      'content/posts/tide.md',
      '---\ntitle: The tide gauge\nslug: tide-gauge\n---\n\nProse.\n',
    );
    expect(item.title).toBe('The tide gauge');
    expect(item.slug).toBe('tide-gauge');
    expect(item.body.trim()).toBe('Prose.');
  });

  it('falls back to the first heading when there is no title', () => {
    const item = extractMarkdown(
      'content/a.md',
      '---\ndraft: false\n---\n\n# A heading\n\nProse.\n',
    );
    expect(item.title).toBe('A heading');
  });

  it('falls back to the filename when there is neither', () => {
    const item = extractMarkdown('content/the-tide-gauge.md', 'Just prose.\n');
    expect(item.title).toBe('the-tide-gauge');
    expect(item.slug).toBe('the-tide-gauge');
  });

  it('derives a slug from a Thaana filename by transliterating it', () => {
    const item = extractMarkdown('content/ބަނދަރު.md', 'Prose.\n');
    expect(item.slug).toBe('bandharu');
  });
});

describe('inferring a content model', () => {
  const items = [
    {
      title: 'A',
      slug: 'a',
      body: '',
      source: 'a.md',
      frontmatter: { title: 'A', date: '2026-01-01', tags: ['x'] },
    },
    {
      title: 'B',
      slug: 'b',
      body: '',
      source: 'b.md',
      frontmatter: { title: 'B', date: '2026-02-01' },
    },
    {
      title: 'C',
      slug: 'c',
      body: '',
      source: 'c.md',
      frontmatter: { title: 'C', date: '2026-03-01', hero: 'x.png' },
    },
  ];

  it('counts how often each field actually appears', () => {
    const usage = inferFieldUsage(items);
    const title = usage.find((entry) => entry.field === 'title');
    const tags = usage.find((entry) => entry.field === 'tags');

    expect(title?.count).toBe(3);
    expect(title?.ratio).toBe(1);
    // A field on one item in three is optional; treating it as required would make the
    // generated schema reject the site's own content.
    expect(tags?.ratio).toBeCloseTo(1 / 3, 5);
  });

  it('records the types a field was seen with', () => {
    const usage = inferFieldUsage(items);
    expect(usage.find((entry) => entry.field === 'tags')?.types).toEqual(['array']);
    expect(usage.find((entry) => entry.field === 'date')?.types).toEqual(['string']);
  });

  it('orders the most common fields first', () => {
    expect(inferFieldUsage(items)[0]?.field).toBe('date');
  });
});
