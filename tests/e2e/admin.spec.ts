import { test, expect, type Page } from '@playwright/test';
import {
  at,
  mockGitHub,
  watchConsole,
  blockEverythingExternal,
  waitForIsland,
  useExampleRegistry,
  useNoRegistry,
  waitForRegistry,
} from './_mocks';
import { parseDocument } from '../../src/lib/frontmatter';

/**
 * The admin, in a browser, against a mocked GitHub API.
 *
 * The commit path is what these exist for: that connecting resolves a token to an
 * identity, that a save sends a PUT to the right path carrying the blob sha it read, that
 * a stale sha surfaces as a conflict rather than an overwrite, and that a guardrail
 * violation blocks approval in the interface rather than only at publish time.
 *
 * Nothing here reaches a real service. `mockGitHub` answers api.github.com and
 * `blockEverythingExternal` aborts anything else, recording it so a leak fails the test.
 */

const TOKEN = `github_pat_${'A1b2C3d4E5f6G7h8I9j0K1'.repeat(2)}`;

/** A valid post file, as it would sit in a connected site repository. */
function postFile(overrides: Record<string, string> = {}, body = 'Body prose here.'): string {
  const front = {
    title: 'The tide gauge at the old harbour',
    slug: 'the-tide-gauge-at-the-old-harbour',
    category: 'environment',
    publishedDate: '2026-02-11T07:30:00.000Z',
    excerpt: 'A century of readings taken by hand.',
    locale: 'dv',
    author: 'A. Editor',
    sourceType: 'human',
    state: 'in-review',
    ...overrides,
  };

  const lines = Object.entries(front).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return ['---', ...lines, '---', '', body, ''].join('\n');
}

/**
 * A file that satisfies every review-time guardrail the `example-news` site carries:
 * `heroImageAlt` and `seo.description` present, at least 250 words, and a translation in
 * each required locale. Anything less is *correctly* blocked, so a test that wants to
 * prove approval works has to produce a genuinely compliant item.
 */
function compliantFile(overrides: Record<string, string> = {}): string {
  const body = `The gauge was installed in 1912 and has been read by hand ever since. ${'The record is patient and unremarkable, which is exactly what makes it useful. '.repeat(20)}`;

  const front = {
    title: 'A compliant piece',
    slug: 'a-compliant-piece',
    category: 'environment',
    publishedDate: '2026-02-11T07:30:00.000Z',
    excerpt: 'Everything this site requires, present and correct.',
    locale: 'dv',
    author: 'A. Editor',
    sourceType: 'human',
    state: 'in-review',
    heroImageAlt: 'A brass tide gauge mounted on a harbour wall.',
    ...overrides,
  };

  const lines = Object.entries(front).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  // `seo` is nested, so it is written as a block rather than through the flat mapper.
  lines.push('seo:', '  description: "A century of readings, taken by hand."', '  noindex: false');

  return ['---', ...lines, '---', '', body, ''].join('\n');
}

const CONTENT_DIR = 'src/content/posts/dv';
const EN_DIR = 'src/content/posts/en';

test.describe('connecting', () => {
  test('refuses a string that is not shaped like a token, without a request', async ({ page }) => {
    const github = await mockGitHub(page, { login: 'example-editor' });
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);

    await page.getByLabel('Access token').fill('not-a-token');
    await page.getByTestId('connect').click();

    await expect(page.getByTestId('connect-status')).toContainText(/does not look like/);
    // Rejected locally: no round trip was spent on an obvious typo.
    expect(github.requests).toEqual([]);
  });

  test('resolves a valid token to its identity', async ({ page }) => {
    const github = await mockGitHub(page, { login: 'example-editor' });
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);

    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();

    await expect(page.getByTestId('connected-as')).toContainText('example-editor');

    // Verified by asking who the token belongs to, not by any endpoint returning 200.
    expect(github.requests[0]).toMatchObject({ method: 'GET', path: '/user' });
  });

  test('reports a rejected token in terms of the token', async ({ page }) => {
    await mockGitHub(page, {}); // no login configured -> 401
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);

    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();

    await expect(page.getByTestId('connect-status')).toContainText(/token was rejected/);
  });

  test('keeps the token in sessionStorage only, never localStorage', async ({ page }) => {
    await mockGitHub(page, { login: 'example-editor' });
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connected-as')).toBeVisible();

    const stored = await page.evaluate(() => ({
      session: Object.entries(sessionStorage).map(([key, value]) => [key, String(value)]),
      local: Object.entries(localStorage).map(([key, value]) => [key, String(value)]),
    }));

    const sessionValues = stored.session.map(([, value]) => value).join(' ');
    expect(sessionValues).toContain(TOKEN);

    // Nothing about the credential may outlive the tab.
    const localValues = stored.local.map(([, value]) => value).join(' ');
    expect(localValues).not.toContain(TOKEN);
  });

  test('shows no sign-in vocabulary or third-party branding', async ({ page }) => {
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    const text = (await page.locator('body').textContent()) ?? '';
    // A page shaped like a credential prompt gets reported as phishing.
    expect(text).not.toMatch(/\bsign in\b/i);
    expect(text).not.toMatch(/\blog in\b/i);
    expect(text).not.toMatch(/\bpassword\b/i);
  });

  test('forgets the session on disconnect', async ({ page }) => {
    await mockGitHub(page, { login: 'example-editor' });
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connected-as')).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByLabel('Access token')).toBeVisible();

    const remaining = await page.evaluate(() =>
      Object.values(sessionStorage).map(String).join(' '),
    );
    expect(remaining).not.toContain(TOKEN);
  });
});

test.describe('the commit path', () => {
  test('saving an edit PUTs to the right path with the sha it read', async ({ page }) => {
    const path = `${CONTENT_DIR}/the-tide-gauge-at-the-old-harbour.md`;
    const github = await mockGitHub(page, {
      login: 'example-editor',
      files: { [path]: postFile() },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-content').click();

    await page.getByRole('button', { name: 'Edit' }).first().click();

    const title = page.getByLabel('Title', { exact: true });
    await expect(title).toHaveValue(/tide gauge/);
    await title.fill('The tide gauge, revisited');

    await page.getByTestId('save').click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    const put = github.requests.find((request) => request.method === 'PUT');
    expect(put, 'no PUT was sent').toBeTruthy();
    expect(put?.path).toBe(`/repos/example-org/example-news/contents/${path}`);

    const body = put?.body as { branch: string; sha?: string; content: string };
    expect(body.branch).toBe('main');
    // The blob sha read with the file is sent back; without it a concurrent edit is lost.
    expect(body.sha).toBeTruthy();

    // What was committed is a real document carrying the edit.
    const committed = Buffer.from(body.content, 'base64').toString('utf8');
    expect(committed).toContain('The tide gauge, revisited');
    expect(committed).toContain('Body prose here.');
    expect(github.files[path]).toContain('The tide gauge, revisited');
  });

  test('a conflicting change is reported, not silently overwritten', async ({ page }) => {
    const path = `${CONTENT_DIR}/the-tide-gauge-at-the-old-harbour.md`;
    const github = await mockGitHub(page, {
      login: 'example-editor',
      files: { [path]: postFile() },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-content').click();
    await page.getByRole('button', { name: 'Edit' }).first().click();

    // Somebody else commits while this editor is typing.
    github.files[path] = postFile({ title: 'Changed by a colleague' });

    await page.getByLabel('Title', { exact: true }).fill('My version');
    await page.getByTestId('save').click();

    await expect(page.locator('.admin__error')).toContainText(/reload and reapply/);
    // Their edit survived.
    expect(github.files[path]).toContain('Changed by a colleague');
  });

  test('refuses to commit an item the build would reject, naming the field', async ({ page }) => {
    const path = `${CONTENT_DIR}/the-tide-gauge-at-the-old-harbour.md`;
    await mockGitHub(page, { login: 'example-editor', files: { [path]: postFile() } });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-content').click();
    await page.getByRole('button', { name: 'Edit' }).first().click();

    // Clearing a required field must fail here, not in CI twenty minutes later.
    await page.getByLabel('Category', { exact: true }).fill('');
    await page.getByTestId('save').click();

    await expect(page.getByTestId('field-errors')).toContainText('category');
  });

  test('flags a slug that another item already uses', async ({ page }) => {
    const first = `${CONTENT_DIR}/first.md`;
    const second = `${CONTENT_DIR}/second.md`;
    await mockGitHub(page, {
      login: 'example-editor',
      files: {
        [first]: postFile({ slug: 'first', title: 'First piece' }),
        [second]: postFile({ slug: 'second', title: 'Second piece' }),
      },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-content').click();
    await page.getByRole('button', { name: 'Edit' }).first().click();

    await page.getByLabel('Slug', { exact: true }).fill('second');
    await expect(page.getByTestId('slug-clash')).toBeVisible();
  });

  test('warns about Latin punctuation inside Thaana while the editor is still looking', async ({
    page,
  }) => {
    const path = `${CONTENT_DIR}/thaana.md`;
    await mockGitHub(page, {
      login: 'example-editor',
      files: {
        [path]: postFile({
          slug: 'thaana-piece',
          title: 'ދިވެހި ސުރުޚީ',
          excerpt: 'ކުރު ޚުލާޞާ',
          locale: 'dv',
        }),
      },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-content').click();
    await page.getByRole('button', { name: 'Edit' }).first().click();

    await page.getByLabel('Excerpt', { exact: true }).fill('ދިވެހި, ބަސް');
    await expect(page.getByTestId('punctuation-warning')).toBeVisible();
  });
});

test.describe('the review queue', () => {
  test('blocks approval on a guardrail violation and says which', async ({ page }) => {
    const path = `${CONTENT_DIR}/affiliate.md`;
    await mockGitHub(page, {
      login: 'example-editor',
      files: {
        // An affiliate offer in the body with no disclosure: the default rule catches it.
        [path]: postFile({ slug: 'affiliate-piece', title: 'A buying guide' }).replace(
          'Body prose here.',
          'Buy it here: https://example.com/product?tag=example-network-21',
        ),
      },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-queue').click();

    await expect(page.getByTestId('queue-item').first()).toBeVisible();
    await expect(page.getByTestId('guardrail-block').first()).toContainText(/affiliate/i);
    // The approve button is genuinely unusable, not merely styled as such.
    await expect(page.getByTestId('approve').first()).toBeDisabled();
  });

  test('approving records a human decision and commits it', async ({ page }) => {
    const path = `${CONTENT_DIR}/compliant.md`;
    const github = await mockGitHub(page, {
      login: 'example-editor',
      files: {
        [path]: compliantFile(),
        // The English translation, so the locale-completeness rule is satisfied. It is
        // already published, so it does not appear in the queue itself.
        [`${EN_DIR}/compliant.md`]: compliantFile({
          locale: 'en',
          slug: 'a-compliant-piece-en',
          translationOf: 'a-compliant-piece',
          state: 'published',
        }),
      },
    });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await waitForRegistry(page);
    await page.getByTestId('tab-queue').click();

    await expect(page.getByTestId('queue-item').first()).toBeVisible();
    await page.getByTestId('approve').first().click();

    await expect
      .poll(() => github.requests.filter((request) => request.method === 'PUT').length)
      .toBeGreaterThan(0);

    // Parsed rather than string-matched: the serialiser quotes YAML scalars, so
    // `state: "approved"` is what lands on disk and a `state: approved` substring check
    // would fail for a reason that has nothing to do with the behaviour under test.
    const committed = parseDocument(github.files[path] ?? '');
    expect(committed.data['state']).toBe('approved');

    // The audit trail names the person, which is what `human-required` later checks.
    const transitions = committed.data['transitions'] as Array<{
      to: string;
      actor: { kind: string; id: string };
    }>;
    const approval = transitions.find((entry) => entry.to === 'approved');
    expect(approval).toBeDefined();
    expect(approval?.actor).toEqual({ kind: 'human', id: 'example-editor' });
  });
});

test.describe('network discipline', () => {
  test('the admin reaches api.github.com and nothing else', async ({ page }) => {
    const guard = await blockEverythingExternal(page);
    const console_ = watchConsole(page);

    // Layered over the blanket block, so GitHub is answered and everything else aborts.
    await mockGitHub(page, { login: 'example-editor' });

    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connected-as')).toBeVisible();

    const nonGitHub = guard.escaped.filter((url) => !url.startsWith('https://api.github.com'));
    expect(nonGitHub, `admin reached: ${nonGitHub.join(', ')}`).toEqual([]);
    expect(console_.errors).toEqual([]);
  });

  test('the admin page is not indexable', async ({ page }) => {
    await useExampleRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

/**
 * The zero-sites state, which is what every operator sees first.
 *
 * This shipped broken: every view in the admin was written `{registry && view === '…' && …}`,
 * so with no registry *nothing* rendered. Clicking a tab updated the view state and the
 * screen never changed — six tabs that looked like dead JavaScript. Settings was gated the
 * same way, which made it unreachable, and Settings is the only screen that matters when you
 * have no sites: it is where you say where the registry lives. The chicken could not reach
 * the egg.
 *
 * Nothing tested this, because every other admin test sets up a registry first. These do not.
 */
test.describe('the admin with no registry configured', () => {
  const TABS = ['dashboard', 'queue', 'content', 'runs', 'sites', 'settings'] as const;

  /** Connect with no registry anywhere: no build-time injection, nothing in localStorage. */
  async function connectWithNoRegistry(page: Page): Promise<void> {
    await mockGitHub(page, { login: 'example-editor' });
    await useNoRegistry(page);
    await page.goto(at('/admin'));
    await waitForIsland(page);
    await page.getByLabel('Access token').fill(TOKEN);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connected-as')).toBeVisible();
  }

  test('every nav tab responds', async ({ page }) => {
    const console_ = watchConsole(page);
    await connectWithNoRegistry(page);

    for (const tab of TABS) {
      await page.getByTestId(`tab-${tab}`).click();
      // The tab itself must register the click...
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-current', 'page');
      // ...and the body must actually show something for it, rather than staying blank.
      await expect(page.locator('.admin__body .admin__panel').first()).toBeVisible();
    }

    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('settings is reachable and usable', async ({ page }) => {
    await connectWithNoRegistry(page);
    await page.getByTestId('tab-settings').click();

    await expect(page.getByTestId('settings')).toBeVisible();
    await expect(page.getByTestId('registry-form')).toBeVisible();

    // Every field an operator has to fill in to escape the empty state.
    for (const field of ['registry-owner', 'registry-name', 'registry-path', 'registry-ref']) {
      await expect(page.getByTestId(field)).toBeEditable();
    }
    await expect(page.getByTestId('registry-save')).toBeEnabled();
  });

  test('settings rejects an unusable location by name instead of saving it', async ({ page }) => {
    await connectWithNoRegistry(page);
    await page.getByTestId('tab-settings').click();

    await page.getByTestId('registry-owner').fill('');
    await page.getByTestId('registry-name').fill('some-repo');
    await page.getByTestId('registry-save').click();

    await expect(page.getByTestId('registry-form-error')).toContainText('owner');
    // Nothing was persisted, so a reload must not resurrect a half-typed location.
    const stored = await page.evaluate(() => localStorage.getItem('dheys-registry-location'));
    expect(stored).toBeNull();
  });

  test('a saved location is remembered and used', async ({ page }) => {
    await connectWithNoRegistry(page);
    await page.getByTestId('tab-settings').click();

    await page.getByTestId('registry-owner').fill('example-org');
    await page.getByTestId('registry-name').fill('registry-repo');
    await page.getByTestId('registry-save').click();

    await expect(page.getByTestId('registry-current')).toContainText('example-org/registry-repo');

    const stored = await page.evaluate(() => localStorage.getItem('dheys-registry-location'));
    expect(stored, 'the location must survive a reload').toContain('registry-repo');

    // And it must not have stored the token alongside it.
    expect(stored).not.toContain(TOKEN);
  });

  test('disconnect works from settings with no registry', async ({ page }) => {
    await connectWithNoRegistry(page);
    await page.getByTestId('tab-settings').click();

    await page.getByTestId('settings-disconnect').click();

    // Back to the connect screen, and the session really is gone.
    await expect(page.getByTestId('connect')).toBeVisible();
    const session = await page.evaluate(() => sessionStorage.getItem('dheys-admin-session'));
    expect(session).toBeNull();
  });
});
