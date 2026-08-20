import { describe, it, expect } from 'vitest';
import { normaliseBase, withBase, stripBase, canonicalUrl, isExternalRef } from '@lib/paths';

/**
 * Base-path resolution is pinned in BOTH hosting modes because a project page
 * (`/dheys-cms/`) and a root deployment (`/`) fail in opposite directions: code that
 * assumes root ships broken links to Pages, and code that hard-codes the sub-path
 * ships broken links everywhere else.
 */

const SUBPATH = '/dheys-cms';
const ROOT = '/';

describe('normaliseBase', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['dheys-cms', '/dheys-cms'],
    ['/dheys-cms', '/dheys-cms'],
    ['/dheys-cms/', '/dheys-cms'],
    ['//dheys-cms//', '/dheys-cms'],
    ['/a/b/', '/a/b'],
    ['  /dheys-cms/  ', '/dheys-cms'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseBase(input)).toBe(expected);
  });

  it('treats null and undefined as root hosting', () => {
    expect(normaliseBase(undefined)).toBe('/');
    expect(normaliseBase(null)).toBe('/');
  });
});

describe('withBase — sub-path hosting', () => {
  it.each([
    ['/', '/dheys-cms/'],
    ['', '/dheys-cms/'],
    ['/about', '/dheys-cms/about'],
    ['about', '/dheys-cms/about'],
    ['/blog/post-one', '/dheys-cms/blog/post-one'],
    ['/rss.xml', '/dheys-cms/rss.xml'],
  ])('%j -> %j', (input, expected) => {
    expect(withBase(input, SUBPATH)).toBe(expected);
  });

  it('is idempotent — a path already carrying the base is untouched', () => {
    expect(withBase('/dheys-cms/about', SUBPATH)).toBe('/dheys-cms/about');
    expect(withBase(withBase('/about', SUBPATH), SUBPATH)).toBe('/dheys-cms/about');
  });

  it('accepts the base with a trailing slash, as Astro supplies it via BASE_URL', () => {
    expect(withBase('/about', '/dheys-cms/')).toBe('/dheys-cms/about');
  });

  it('never emits a double slash', () => {
    const outputs = ['/', '//', '/about', '//about//'].map((p) => withBase(p, SUBPATH));
    for (const out of outputs) expect(out).not.toMatch(/\/\//);
  });

  it('preserves query strings and hashes', () => {
    expect(withBase('/search?q=thaana', SUBPATH)).toBe('/dheys-cms/search?q=thaana');
    expect(withBase('/article#notes', SUBPATH)).toBe('/dheys-cms/article#notes');
  });
});

describe('withBase — root hosting', () => {
  it.each([
    ['/', '/'],
    ['/about', '/about'],
    ['about', '/about'],
    ['/rss.xml', '/rss.xml'],
  ])('%j -> %j', (input, expected) => {
    expect(withBase(input, ROOT)).toBe(expected);
  });

  it('defaults to root when no base is supplied at all', () => {
    expect(withBase('/about')).toBe('/about');
  });
});

describe('withBase — values that must never be rewritten', () => {
  it.each([
    'https://example.com/x',
    'http://example.org',
    '//example.net/asset.js',
    'mailto:editor@example.com',
    'tel:+15550100',
    'data:image/svg+xml,%3Csvg%3E',
    '#main-content',
  ])('%s passes through untouched', (value) => {
    expect(isExternalRef(value)).toBe(true);
    expect(withBase(value, SUBPATH)).toBe(value);
    expect(withBase(value, ROOT)).toBe(value);
  });
});

describe('stripBase', () => {
  it('removes a sub-path base', () => {
    expect(stripBase('/dheys-cms/about', SUBPATH)).toBe('/about');
    expect(stripBase('/dheys-cms', SUBPATH)).toBe('/');
    expect(stripBase('/dheys-cms/', SUBPATH)).toBe('/');
  });

  it('is a no-op under root hosting', () => {
    expect(stripBase('/about', ROOT)).toBe('/about');
  });

  it('round-trips with withBase in both modes', () => {
    for (const base of [SUBPATH, ROOT]) {
      for (const path of ['/', '/about', '/blog/post-one']) {
        expect(stripBase(withBase(path, base), base)).toBe(path);
      }
    }
  });
});

describe('canonicalUrl', () => {
  const site = 'https://nazilafeef.github.io';

  it('builds an absolute URL under sub-path hosting', () => {
    expect(canonicalUrl('/about', site, SUBPATH)).toBe('https://nazilafeef.github.io/dheys-cms/about');
  });

  it('builds an absolute URL under root hosting', () => {
    expect(canonicalUrl('/about', 'https://cms.example.test', ROOT)).toBe(
      'https://cms.example.test/about',
    );
  });

  it('tolerates a site value with a trailing slash', () => {
    expect(canonicalUrl('/about', `${site}/`, SUBPATH)).toBe(
      'https://nazilafeef.github.io/dheys-cms/about',
    );
  });

  it('leaves an already-absolute URL alone', () => {
    expect(canonicalUrl('https://example.com/x', site, SUBPATH)).toBe('https://example.com/x');
  });
});
