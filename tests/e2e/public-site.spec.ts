import { test, expect } from '@playwright/test';
import { at, watchConsole } from './_mocks';

/**
 * The public site, in a real browser, against a real production build.
 *
 * These assert the things a unit test structurally cannot: that the page actually renders,
 * that `dir` and `lang` reach the document, that no script errors on load, and that an
 * article page stays inside its JavaScript budget.
 */

const ARTICLE = at('/articles/the-tide-gauge-at-the-old-harbour');

test.describe('home', () => {
  test('renders and is announced as English, left to right', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(at('/'));

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toContainText('Dheys CMS');

    expect(console_.errors, 'console errors on the home page').toEqual([]);
    expect(console_.warnings, 'console warnings on the home page').toEqual([]);
  });

  test('lists articles and links to them', async ({ page }) => {
    await page.goto(at('/'));
    const first = page.locator('article a').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.locator('h1')).toBeVisible();
  });

  test('offers a skip link that reaches the main content', async ({ page }) => {
    await page.goto(at('/'));
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});

test.describe('right-to-left locales', () => {
  test('Dhivehi renders as RTL with the correct lang', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(at('/dv'));

    await expect(page.locator('html')).toHaveAttribute('lang', 'dv');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Thaana actually on the page, not just a language attribute over English text.
    const heading = await page.locator('h1').first().textContent();
    expect(heading ?? '').toMatch(/[ހ-޿]/);

    expect(console_.errors).toEqual([]);
    expect(console_.warnings).toEqual([]);
  });

  test('Arabic renders as RTL with the correct lang', async ({ page }) => {
    await page.goto(at('/ar'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('lays the page out from the right, not merely labels it', async ({ page }) => {
    await page.goto(at('/dv'));
    // The computed writing direction is what a reader experiences; the attribute alone
    // would still be satisfied by a stylesheet that hard-codes left-to-right gutters.
    const direction = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).direction);
    expect(direction).toBe('rtl');
  });

  test('uses Thaana punctuation rather than Latin in Dhivehi prose', async ({ page }) => {
    await page.goto(at('/dv/articles/bandharuge-dhiyavaru-maapu'));
    const prose = (await page.locator('.prose').textContent()) ?? '';

    // Every Latin comma/semicolon/question mark inside a Thaana run is a rendering bug.
    const thaanaLines = prose.split('\n').filter((line) => /[ހ-޿]/.test(line));
    for (const line of thaanaLines) {
      expect(line, `Latin punctuation inside Thaana: ${line}`).not.toMatch(/[,;?]/);
    }
  });
});

test.describe('article page', () => {
  test('renders the byline, date and reading time', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(ARTICLE);

    await expect(page.locator('h1')).toContainText('tide gauge');
    await expect(page.locator('time').first()).toBeVisible();
    // Scoped to the article's own meta line: the related-post cards carry reading times
    // too, so an unscoped match is ambiguous.
    await expect(page.locator('.article__meta').getByText(/min read/)).toBeVisible();
    // By role rather than by a `/^By /` regex: Playwright normalises whitespace for string
    // matches but not for regex ones, and the byline anchor spans several source lines.
    await expect(page.locator('.article__meta').getByRole('link')).toContainText('Aminath Rasheed');

    expect(console_.errors).toEqual([]);
    expect(console_.warnings).toEqual([]);
  });

  test('table of contents anchors resolve to real headings', async ({ page }) => {
    await page.goto(ARTICLE);
    const links = page.locator('.toc__list a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute('href');
      expect(href).toBeTruthy();
      const id = decodeURIComponent((href ?? '').replace('#', ''));
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  });

  test('stays under the 30 KB JavaScript budget', async ({ page }) => {
    const scriptBytes: number[] = [];

    page.on('response', async (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('javascript')) return;
      try {
        scriptBytes.push((await response.body()).byteLength);
      } catch {
        /* a response with no retrievable body cannot be weighed */
      }
    });

    await page.goto(ARTICLE, { waitUntil: 'networkidle' });

    const total = scriptBytes.reduce((sum, bytes) => sum + bytes, 0);
    expect(total, `article page shipped ${total} bytes of JavaScript`).toBeLessThan(30 * 1024);
  });

  test('renders an attribution line on AI-assisted content', async ({ page }) => {
    await page.goto(at('/articles/reading-the-monsoon-from-a-century-of-notes'));
    await expect(page.getByText(/Written by claude-opus-5/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /How this article was made/i })).toBeVisible();
    // The sources are the part a reader can actually check.
    await expect(page.getByRole('link', { name: /Harbour authority annual report/ })).toBeVisible();
  });

  test('renders no attribution on human-written content', async ({ page }) => {
    await page.goto(ARTICLE);
    await expect(page.getByText(/Written by claude/)).toHaveCount(0);
  });

  test('shows the affiliate disclosure above the article, not below it', async ({ page }) => {
    await page.goto(at('/articles/choosing-a-tide-clock'));

    const disclosure = page.locator('.affiliate');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText(/affiliate links/i);

    // A disclosure a reader meets after the recommendation is a disclosure in name only.
    const disclosureY = (await disclosure.boundingBox())?.y ?? Infinity;
    const bodyY = (await page.locator('.article__body').boundingBox())?.y ?? 0;
    expect(disclosureY).toBeLessThan(bodyY);
  });

  test('makes no network request for an unfilled ad slot', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(ARTICLE, { waitUntil: 'networkidle' });

    // The slot renders inert; nothing is fetched on its behalf.
    await expect(page.locator('.ad-slot[data-filled="false"]')).toHaveCount(1);
    await expect(page.locator('.ad-slot[data-filled="false"]')).toBeHidden();

    const offOrigin = requests.filter((url) => !url.includes('127.0.0.1'));
    expect(offOrigin, `article page made off-origin requests: ${offOrigin.join(', ')}`).toEqual([]);
  });

  test('share links are plain anchors with no third-party script', async ({ page }) => {
    await page.goto(ARTICLE);
    const share = page.locator('.share__list a').first();
    await expect(share).toHaveAttribute('rel', /noopener/);
    await expect(share).toHaveAttribute('href', /^https:\/\//);
  });
});

test.describe('colour scheme', () => {
  test('honours the system preference with no flash', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(at('/'));

    const background = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor);

    // Warm near-black, never pure black, and never the light ground.
    expect(background).not.toBe('rgb(255, 255, 255)');
    expect(background).not.toBe('rgb(0, 0, 0)');
  });

  test('the toggle switches scheme and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(at('/'));

    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('404', () => {
  test('a missing path renders the real 404 document', async ({ page }) => {
    // `astro preview` serves 404.html for unmatched paths, as GitHub Pages does.
    const response = await page.goto(at('/no-such-page-exists'));
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText('Page not found');
  });

  test('the 404 page is not indexable', async ({ page }) => {
    await page.goto(at('/404'));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('feeds and machine-readable files', () => {
  test('RSS is served as XML and carries items', async ({ request }) => {
    const response = await request.get(at('/rss.xml'));
    expect(response.status()).toBe(200);

    /*
     * XML, but not necessarily `application/rss+xml`.
     *
     * The endpoint sets that Content-Type, and on a static host it is ignored: the file is
     * `dist/rss.xml` and the server picks the type from the extension. GitHub Pages serves
     * it as `text/xml`, exactly as `astro preview` does. Asserting the endpoint's header
     * here would be asserting something the deployment cannot deliver — and feed readers
     * dispatch on the document element, not the header.
     */
    expect(response.headers()['content-type']).toContain('xml');

    const body = await response.text();
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain('<item>');
  });

  test('the JSON feed parses as JSON Feed 1.1', async ({ request }) => {
    const response = await request.get(at('/feed.json'));
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { version: string; items: unknown[] };
    expect(payload.version).toBe('https://jsonfeed.org/version/1.1');
    expect(payload.items.length).toBeGreaterThan(0);
  });

  test('the sitemap lists absolute URLs carrying the base path', async ({ request }) => {
    const response = await request.get(at('/sitemap.xml'));
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/dheys-cms\//);
  });

  test('robots.txt points at the sitemaps and hides the admin', async ({ request }) => {
    const response = await request.get(at('/robots.txt'));
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('Sitemap:');
    expect(body).toContain('Disallow: /dheys-cms/admin');
  });

  test('llms.txt marks which articles a model wrote', async ({ request }) => {
    const response = await request.get(at('/llms.txt'));
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('# Dheys CMS');
    expect(body).toMatch(/written with claude-opus-5/);
  });
});

test.describe('SEO head', () => {
  test('an article carries a canonical URL with the base path', async ({ page }) => {
    await page.goto(ARTICLE);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/dheys-cms/articles/the-tide-gauge-at-the-old-harbour');
  });

  test('hreflang points at each translation’s own slug', async ({ page }) => {
    await page.goto(ARTICLE);
    const arabic = page.locator('link[rel="alternate"][hreflang="ar"]');
    await expect(arabic).toHaveCount(1);
    // The Arabic translation has its own slug; a naive implementation emits the English one.
    await expect(arabic).toHaveAttribute('href', /mikyas-almad-fi-almina-alqadim/);
  });

  test('an article emits NewsArticle JSON-LD that parses', async ({ page }) => {
    await page.goto(ARTICLE);
    const raw = await page.locator('script[type="application/ld+json"]').textContent();
    const payload = JSON.parse(raw ?? '{}') as { '@graph': Array<{ '@type': string }> };
    const types = payload['@graph'].map((node) => node['@type']);
    expect(types).toContain('NewsArticle');
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  test('AI-authored content is not credited to a Person in structured data', async ({ page }) => {
    await page.goto(at('/articles/reading-the-monsoon-from-a-century-of-notes'));
    const raw = await page.locator('script[type="application/ld+json"]').textContent();
    const payload = JSON.parse(raw ?? '{}') as {
      '@graph': Array<{ '@type': string; author?: { '@type': string; name: string } }>;
    };
    const article = payload['@graph'].find((node) => node['@type'] === 'NewsArticle');
    expect(article?.author?.['@type']).toBe('Organization');
    expect(article?.author?.name).toContain('claude-opus-5');
  });
});

test.describe('language switching', () => {
  test('offers the article in its other languages, at their own slugs', async ({ page }) => {
    await page.goto(ARTICLE);
    const dhivehi = page.locator('.locale-switcher a[hreflang="dv"]');
    await expect(dhivehi).toHaveCount(1);

    await dhivehi.click();
    await expect(page).toHaveURL(/\/dv\/articles\/bandharuge-dhiyavaru-maapu/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
