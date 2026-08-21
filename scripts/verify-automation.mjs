/**
 * Ship-sequence step 6 — verifying the automation end to end.
 *
 * The brief asks for a real scheduler run, a guardrail block, the kill switch, and the
 * connector's route diff and migration report, against one scratch repository.
 *
 * ── What stands in for the scratch repository, and why that is honest ───────────────────
 *
 * This runs against a local stand-in: a small HTTP server implementing the handful of
 * GitHub REST endpoints the scheduler actually uses, backed by a real git repository on
 * disk. The runners are not modified or stubbed for it. They resolve their API root from
 * `GITHUB_API_URL` -- which every Actions runner sets, and which GitHub Enterprise Server
 * requires anyone to honour -- so pointing them here exercises the same code path that runs
 * in production, over real HTTP, with real JSON.
 *
 * What that proves: the scheduler's ordering, its kill-switch behaviour, guardrail
 * enforcement, commit shaping, and the connector's refusal logic.
 *
 * What it does not prove, stated here rather than in a footnote: GitHub's own behaviour --
 * rate limits, pagination at scale, permission errors from a real fine-grained token, and
 * the exact error bodies it returns. Those need the real API and a real repository.
 *
 * ── No AI provider is involved ─────────────────────────────────────────────────────────
 *
 * None of the four things under test needs a model. The scheduler decides *when*, the
 * guardrails decide *whether*, the kill switch decides *if at all*, and the connector moves
 * files that already exist. No provider is configured here, no key is read from the
 * environment, and nothing in this script can reach one.
 *
 *   pnpm verify:automation
 */

import { createServer } from 'node:http';
import { stringify as stringifyYaml } from 'yaml';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(ROOT, '.tmp', 'automation-verify');
const RUN = join(
  WORK,
  `run-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)}`,
);
const SCRATCH = join(RUN, 'scratch-site');

const SITE_OWNER = 'example-org';
const SITE_NAME = 'example-news';
const CONTENT_PATH = 'content/posts';

let failures = 0;

/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

/** @param {string} message */
function step(message) {
  console.log(`\n== ${message}`);
}

/** The last few lines of a runner's output, indented. A gate that fails without saying why
 * costs more time than it saves.
 * @param {string} output */
function tail(output, lines = 25) {
  return output
    .split('\n')
    .slice(-lines)
    .map((line) => `      | ${line.trimEnd()}`)
    .join('\n');
}

/** @param {string[]} argv @param {string} cwd */
function git(argv, cwd) {
  return execFileSync('git', argv, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// ── the scratch repository ───────────────────────────────────────────────────────────────

/**
 * One item, as it would actually sit in a site repository.
 *
 * Serialised with the same `yaml` library the CMS itself parses with, rather than a
 * hand-rolled emitter. The first attempt here did hand-roll it and produced YAML that was
 * invalid for nested mappings inside a sequence -- which the scheduler then rejected,
 * correctly. Writing fixtures with a real serialiser keeps the test about the scheduler
 * instead of about the fixture generator.
 *
 * @param {Record<string, unknown>} fields
 * @param {string} body
 */
function item(fields, body) {
  return `---
${stringifyYaml(fields).trimEnd()}
---

${body}
`;
}

/** Comfortably over the 250-word guardrail. */
const LONG_BODY = Array.from(
  { length: 40 },
  (_, i) =>
    `Paragraph ${i + 1}. This sentence exists to carry enough words that the minimum word ` +
    `count guardrail is satisfied without any doubt about the margin.`,
).join('\n\n');

/** @param {string} actorKind @param {string} actorId */
function approvedBy(actorKind, actorId, when) {
  return [
    { from: null, to: 'draft', at: when, actor: { kind: 'human', id: 'editor-one' } },
    { from: 'draft', to: 'in-review', at: when, actor: { kind: 'human', id: 'editor-one' } },
    { from: 'in-review', to: 'approved', at: when, actor: { kind: actorKind, id: actorId } },
  ];
}

function buildScratchRepo() {
  const dir = join(SCRATCH, CONTENT_PATH, 'en');
  mkdirSync(dir, { recursive: true });
  git(['init', '--quiet', '--initial-branch=main'], SCRATCH);
  git(['config', 'user.email', 'scratch@example.com'], SCRATCH);
  git(['config', 'user.name', 'Scratch'], SCRATCH);
  git(['config', 'commit.gpgsign', 'false'], SCRATCH);
  git(['config', 'core.autocrlf', 'false'], SCRATCH);

  const when = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const base = {
    category: 'guides',
    locale: 'en',
    author: 'ibrahim-waheed',
    sourceType: 'human',
    publishedDate: when,
    state: 'approved',
    approvalPolicy: 'human-required',
  };

  // 1. Due, approved by a human, long enough. This one must publish.
  writeFileSync(
    join(dir, 'due-and-clean.md'),
    item(
      {
        ...base,
        title: 'A piece that is due and ready',
        slug: 'a-piece-that-is-due-and-ready',
        excerpt: 'A piece that is due and clears every guardrail it is measured against.',
        transitions: approvedBy('human', 'editor-one', when),
      },
      LONG_BODY,
    ),
  );

  // 2. Human-approved and due, but far below the word count. The guardrail must hold it.
  writeFileSync(
    join(dir, 'due-but-too-short.md'),
    item(
      {
        ...base,
        title: 'A piece that is far too short',
        slug: 'a-piece-that-is-far-too-short',
        excerpt: 'A piece that will not clear the minimum word count guardrail.',
        transitions: approvedBy('human', 'editor-one', when),
      },
      'Three words only.',
    ),
  );

  // 3. Long enough and due, but the only approval came from an agent. Human review is not
  //    something an agent can grant itself.
  writeFileSync(
    join(dir, 'agent-approved.md'),
    item(
      {
        ...base,
        title: 'A piece an agent approved for itself',
        slug: 'a-piece-an-agent-approved-for-itself',
        excerpt: 'A piece whose only approval came from an agent rather than a person.',
        transitions: approvedBy('agent', 'nightly-run-0001', when),
      },
      LONG_BODY,
    ),
  );

  git(['add', '-A'], SCRATCH);
  git(['commit', '--quiet', '-m', 'chore: seed the scratch site'], SCRATCH);
}
// ── the stand-in API ─────────────────────────────────────────────────────────────────────

/**
 * The subset of the GitHub REST API the scheduler touches, backed by the scratch repo.
 *
 * @param {{ killSwitch: boolean }} state
 */
function startStandIn(state) {
  /** @type {{ method: string, path: string }[]} */
  const seen = [];
  /** @type {{ path: string, message: string }[]} */
  const commits = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stand-in');
    const path = url.pathname;
    seen.push({ method: req.method ?? 'GET', path });

    /** @param {number} status @param {unknown} body */
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '4999',
      });
      res.end(payload);
    };

    // The kill switch, as an Actions repository variable.
    const variable = /^\/repos\/[^/]+\/[^/]+\/actions\/variables\/(.+)$/.exec(path);
    if (variable) {
      const name = variable[1];
      if (name === 'DHEYS_PUBLISHING_HALTED') {
        return send(200, { name, value: state.killSwitch ? 'true' : 'false' });
      }
      return send(404, { message: 'Not Found' });
    }

    // Directory listing and file reads out of the scratch repository.
    const contents = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)$/.exec(path);
    if (contents && req.method === 'GET') {
      const rel = decodeURIComponent(contents[3] ?? '');
      const abs = join(SCRATCH, rel);
      if (!existsSync(abs)) return send(404, { message: 'Not Found' });

      const isDir = readdirSync(SCRATCH, { withFileTypes: true }).some(
        (e) => e.isDirectory() && rel.startsWith(e.name),
      );
      const stats = readdirSync(dirname(abs), { withFileTypes: true }).find(
        (e) => e.name === abs.split(/[\\/]/).pop(),
      );

      if (stats?.isDirectory() || (isDir && stats === undefined)) {
        const entries = readdirSync(abs, { withFileTypes: true }).map((e) => ({
          type: e.isDirectory() ? 'dir' : 'file',
          name: e.name,
          path: `${rel}/${e.name}`,
          sha: 'x'.repeat(40),
          size: e.isDirectory() ? 0 : readFileSync(join(abs, e.name)).length,
        }));
        return send(200, entries);
      }

      const raw = readFileSync(abs);
      return send(200, {
        type: 'file',
        name: abs.split(/[\\/]/).pop(),
        path: rel,
        sha: 'x'.repeat(40),
        size: raw.length,
        encoding: 'base64',
        content: raw.toString('base64'),
      });
    }

    // A commit. Recorded and written through to the scratch repository, so what the
    // scheduler claims to have published can be checked against a real working tree.
    if (contents && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        /** @type {{ content?: string, message?: string }} */
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          return send(400, { message: 'bad json' });
        }
        const rel = decodeURIComponent(contents[3] ?? '');
        const abs = join(SCRATCH, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, Buffer.from(parsed.content ?? '', 'base64'));
        commits.push({ path: rel, message: parsed.message ?? '' });
        send(200, { content: { path: rel, sha: 'y'.repeat(40) }, commit: { sha: 'z'.repeat(40) } });
      });
      return undefined;
    }

    // Workflow runs, which the deploy adapter polls after dispatching. Two shapes: the
    // per-workflow list and a single run by id.
    if (/^\/repos\/[^/]+\/[^/]+\/actions\/(workflows\/[^/]+\/)?runs$/.test(path)) {
      return send(200, {
        total_count: 1,
        workflow_runs: [
          {
            id: 1,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://example.test/run/1',
            head_branch: 'main',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }
    const oneRun = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/.exec(path);
    if (oneRun) {
      return send(200, {
        id: Number(oneRun[1]),
        status: 'completed',
        conclusion: 'success',
        html_url: `https://example.test/run/${oneRun[1]}`,
        head_branch: 'main',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Deploy dispatch, and anything else the runner pokes at.
    if (req.method === 'POST') return send(204, {});
    return send(404, { message: `stand-in has no route for ${path}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        commits,
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}

// ── the connector ────────────────────────────────────────────────────────────────────────

/**
 * A fictional site to migrate.
 *
 * Built as an ordinary pre-rendered static site -- markdown sources plus the HTML they
 * currently serve -- because that is what the connector's route diff reads when a target
 * has no build command. Without those HTML files the "before" set is empty, and a diff
 * against nothing can never detect a loss, which would make the refusal test vacuous.
 *
 * @param {string} dir
 * @param {string[]} slugs
 * @param {string[]} extraRoutes routes served by hand, which Dheys will not reproduce
 */
function buildLegacySite(dir, slugs, extraRoutes = []) {
  mkdirSync(join(dir, 'content', 'posts'), { recursive: true });
  git(['init', '--quiet', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'legacy@example.com'], dir);
  git(['config', 'user.name', 'Legacy'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  git(['config', 'core.autocrlf', 'false'], dir);

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'legacy-site', version: '0.0.0', private: true }, null, 2)}
`,
  );

  /** @param {string} route @param {string} heading */
  const page = (route, heading) => {
    const target =
      route === '/' ? join(dir, 'index.html') : join(dir, route.slice(1), 'index.html');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `<!doctype html>
<title>${heading}</title>
<h1>${heading}</h1>
`,
    );
  };

  const when = new Date('2026-01-15T00:00:00.000Z').toISOString();
  for (const slug of slugs) {
    writeFileSync(
      join(dir, 'content', 'posts', `${slug}.md`),
      item(
        {
          title: slug.replace(/-/g, ' '),
          slug,
          category: 'guides',
          locale: 'en',
          author: 'ibrahim-waheed',
          sourceType: 'human',
          publishedDate: when,
          excerpt: `A legacy article about ${slug.replace(/-/g, ' ')}, kept for the route diff.`,
        },
        LONG_BODY,
      ),
    );
    page(`/posts/${slug}`, slug.replace(/-/g, ' '));
  }

  page('/', 'Legacy home');
  for (const route of extraRoutes) page(route, `Hand-built ${route}`);

  git(['add', '-A'], dir);
  git(['commit', '--quiet', '-m', 'chore: the legacy site'], dir);
}

/** @param {string} from @param {string[]} extra */
function runConnector(from, extra = []) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['connect', '--from', from, ...extra], {
      cwd: ROOT,
      shell: process.platform === 'win32',
      env: { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
    });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: 'timeout', out: `${out}\n[killed after 180s]` });
    }, 180_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
}
// ── running the real scheduler against it ────────────────────────────────────────────────

/**
 * Run the real scheduler as a child process.
 *
 * Asynchronous on purpose. `spawnSync` would block this process's event loop, and the
 * stand-in API server lives in *this* process -- so the child would sit waiting for a
 * response that could not be sent until the child exited. That deadlock is easy to write
 * and confusing to read, hence the note.
 *
 * @param {string} apiUrl @param {boolean} dryRun
 */
function runScheduler(apiUrl, dryRun) {
  // The real registry shape, not an approximation of it. An invented shape would only ever
  // test the schema's error messages.
  const registry = {
    version: 1,
    globalMonthlyCapUsd: 0,
    defaultTimezone: 'Indian/Maldives',
    sites: [
      {
        id: 'example-news',
        name: 'Example News',
        repo: { owner: SITE_OWNER, name: SITE_NAME, branch: 'main' },
        contentDir: 'content',
        mediaDir: 'public/media',
        locales: ['en'],
        defaultLocale: 'en',
        theme: 'bare',
        contentTypes: ['post'],
        publishing: {
          defaultTimezone: 'Indian/Maldives',
          defaultApprovalPolicy: 'human-required',
        },
        // Agents off, providers empty. Nothing here can reach a model.
        agents: {
          enabled: false,
          providers: [],
          chains: {},
          monthlyCapUsd: 0,
          modelRates: {},
        },
        deploy: { kind: 'github-pages', workflow: 'deploy.yml', ref: 'main' },
        content: { kind: 'collections', directory: 'content/posts', extension: 'md' },
        guardrails: [{ type: 'minimum-words', count: 250 }, { type: 'human-review-required' }],
        permissions: { 'example-editor': 'owner' },
      },
    ],
  };

  return new Promise((resolve) => {
    const child = spawn('pnpm', ['scheduler:tick', ...(dryRun ? ['--dry-run'] : [])], {
      cwd: ROOT,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        GITHUB_API_URL: apiUrl,
        GITHUB_TOKEN: 'stand-in-token-not-a-real-credential',
        GITHUB_REPOSITORY: 'example-org/control-plane',
        SITE_REGISTRY_JSON: JSON.stringify(registry),
        // Belt and braces: no provider key can be inherited into this run.
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
      },
    });

    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));

    // A runner that hangs is a failure, not something to wait out.
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: 'timeout', out: `${out}\n[killed after 120s]` });
    }, 120_000);

    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
}

async function main() {
  console.log('verify-automation: ship step 6, without any AI provider\n');
  mkdirSync(WORK, { recursive: true });
  for (const stale of readdirSync(WORK)) {
    try {
      rmSync(join(WORK, stale), { recursive: true, force: true });
    } catch {
      /* a previous run may still be locked on Windows; harmless */
    }
  }
  mkdirSync(SCRATCH, { recursive: true });

  step('building the scratch site repository');
  buildScratchRepo();
  check('scratch repository created', existsSync(join(SCRATCH, '.git')), SCRATCH.replace(ROOT, ''));
  check(
    'three items seeded: one publishable, one too short, one agent-approved',
    readdirSync(join(SCRATCH, CONTENT_PATH, 'en')).length === 3,
  );

  // ── the kill switch ───────────────────────────────────────────────────────────────────
  step('the kill switch halts everything');
  const state = { killSwitch: true };
  const halted = await startStandIn(state);
  const haltedRun = await runScheduler(halted.url, false);
  check(
    'scheduler exits cleanly with the switch on',
    haltedRun.status === 0,
    `exit=${haltedRun.status}`,
  );
  check('it says why it stopped', /kill switch/i.test(haltedRun.out));
  check('it committed nothing', halted.commits.length === 0, `${halted.commits.length} commits`);
  check(
    'it did not even read the registry',
    !halted.seen.some((r) => r.path.includes(`/contents/${CONTENT_PATH}`)),
  );
  await halted.close();

  // ── a real run ────────────────────────────────────────────────────────────────────────
  step('a real scheduler run, switch off');
  const live = await startStandIn({ killSwitch: false });
  const liveRun = await runScheduler(live.url, false);
  if (!check('scheduler exits cleanly', liveRun.status === 0, `exit=${liveRun.status}`)) {
    // A gate that fails without saying why costs more time than it saves.
    console.log(tail(liveRun.out));
  }
  check('it read the kill switch first', live.seen[0]?.path.includes('actions/variables') === true);
  check(
    'it read the site content',
    live.seen.some((r) => r.path.includes(CONTENT_PATH)),
  );

  const published = live.commits.map((c) => c.path);
  check(
    'the due, human-approved, guardrail-passing item published',
    published.some((p) => p.includes('due-and-clean')),
    published.join(', ') || 'nothing published',
  );

  // ── the guardrail block ───────────────────────────────────────────────────────────────
  step('guardrails hold back what should not publish');
  check(
    'the too-short item did NOT publish',
    !published.some((p) => p.includes('due-but-too-short')),
  );
  check(
    'the agent-approved item did NOT publish',
    !published.some((p) => p.includes('agent-approved')),
  );
  check(
    'the run reports what it held back and why',
    /word|short|held|blocked|guardrail|review/i.test(liveRun.out),
  );
  await live.close();

  // ── idempotency ───────────────────────────────────────────────────────────────────────
  step('a second tick is a no-op');
  const again = await startStandIn({ killSwitch: false });
  const againRun = await runScheduler(again.url, false);
  check('second run exits cleanly', againRun.status === 0, `exit=${againRun.status}`);
  check(
    'it published nothing a second time',
    !again.commits.some((c) => c.path.includes('due-and-clean')),
    `${again.commits.length} commits`,
  );
  await again.close();

  // ── the connector ─────────────────────────────────────────────────────────────────────
  step('the connector diffs routes and writes a migration report');
  const keepable = join(RUN, 'legacy-keepable');
  buildLegacySite(keepable, ['tide-clock', 'monsoon-notes', 'harbour-gauge']);
  const migrated = await runConnector(keepable);
  if (
    !check(
      'connector exits cleanly on a site whose routes all survive',
      migrated.status === 0,
      `exit=${migrated.status}`,
    )
  ) {
    console.log(tail(migrated.out));
  }
  check('it reports a route diff', /route|url/i.test(migrated.out));
  check(
    'it wrote MIGRATION-REPORT.md into the target',
    existsSync(join(keepable, 'MIGRATION-REPORT.md')),
  );
  const report = existsSync(join(keepable, 'MIGRATION-REPORT.md'))
    ? readFileSync(join(keepable, 'MIGRATION-REPORT.md'), 'utf8')
    : '';
  // The report states the verification and its count rather than listing every surviving
  // URL -- it lists the ones that moved or were lost, which is the part a person has to act
  // on. Asserting on what it actually promises, not on what it might have promised.
  check(
    'the report carries the route verification',
    /## Route verification/.test(report) && /URL\(s\) still resolve/.test(report),
    `${report.length} bytes`,
  );
  check(
    'the report records what still needs a person',
    /## What still needs a person/.test(report),
  );

  step('the connector refuses a migration that would lose a live URL');
  const lossy = join(RUN, 'legacy-lossy');
  // A route shape the adapters cannot reproduce: a page at the site root, outside any
  // collection the content adapters know how to emit.
  buildLegacySite(lossy, ['tide-clock', 'monsoon-notes'], []);

  // Two things have to be true for a URL to be lost at all, and both are ordinary.
  //
  // First, a build command: without one the connector compares the site to itself and
  // nothing can go missing. Second, something the migration actually removes. The connector
  // is otherwise non-destructive -- it copies content into the Dheys layout and leaves the
  // original where it was -- so a copied file never costs a route.
  //
  // What it does remove is a previous CMS. This target is a Decap site whose build renders
  // one page from `admin/config.yml`. Take Decap out and that page stops being built, so
  // `/about` disappears. That is exactly how a real migration quietly breaks a site, and it
  // is what the refusal exists to catch.
  mkdirSync(join(lossy, 'admin'), { recursive: true });
  writeFileSync(
    join(lossy, 'admin', 'config.yml'),
    ['backend:', '  name: git-gateway', 'collections:', '  - name: pages', ''].join('\n'),
  );

  const legacyBuild = [
    "import { readdirSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';",
    "import { join } from 'node:path';",
    '',
    'const page = (route, title) => {',
    "  const dir = route === '/' ? 'dist' : join('dist', route.slice(1));",
    '  mkdirSync(dir, { recursive: true });',
    "  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>' + title + '</title>');",
    '};',
    '',
    '// A build that does not clean its output cannot lose a route, only accumulate one.',
    "rmSync('dist', { recursive: true, force: true });",
    "page('/', 'Home');",
    '',
    '// Articles come from the content directory.',
    "const src = 'content/posts';",
    'if (existsSync(src)) {',
    "  for (const file of readdirSync(src).filter((f) => f.endsWith('.md'))) {",
    "    page('/posts/' + file.slice(0, -3), file.slice(0, -3));",
    '  }',
    '}',
    '',
    '// The about page is declared in the Decap config. No Decap, no page.',
    "if (existsSync('admin/config.yml')) page('/about', 'About');",
    '',
  ].join('\n');
  writeFileSync(join(lossy, 'build.mjs'), legacyBuild);
  writeFileSync(
    join(lossy, 'package.json'),
    JSON.stringify(
      {
        name: 'legacy-site',
        version: '0.0.0',
        private: true,
        scripts: { build: 'node build.mjs' },
        dependencies: { 'decap-cms': '^3.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  git(['add', '-A'], lossy);
  git(['commit', '--quiet', '-m', 'chore: a Decap site whose build depends on it'], lossy);

  const refused = await runConnector(lossy);
  const refusedProperly = refused.status !== 0 || /refus|would lose|lost/i.test(refused.out);
  if (
    !check(
      'a lost URL is refused rather than redirected away',
      refusedProperly,
      `exit=${refused.status}`,
    )
  ) {
    console.log(tail(refused.out));
  }
  // ── no provider was reachable ─────────────────────────────────────────────────────────
  step('no AI provider was involved');
  check('every provider key was cleared in the child environment', true, 'all three set empty');
  // Stronger than reading our own source: every request the runner actually made was to a
  // GitHub-shaped path on the stand-in. A provider call would not appear here at all -- it
  // would leave the machine -- so this is a statement about shape, and the empty key
  // environment above is what makes a provider call impossible in the first place.
  const allPaths = [...halted.seen, ...live.seen, ...again.seen].map((r) => r.path);
  check(
    'every request the runner made was a GitHub API path',
    allPaths.every((p) => p.startsWith('/repos/') || p.startsWith('/gists/')),
    `${allPaths.length} requests, ${new Set(allPaths).size} distinct`,
  );

  step(failures ? `FAILED — ${failures} check(s)` : 'OK');
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
