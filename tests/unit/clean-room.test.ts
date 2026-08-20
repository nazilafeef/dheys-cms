import { describe, it, expect } from 'vitest';
import {
  scanText,
  formatViolations,
  ALLOWED_DOMAINS,
  OWN_REPO,
} from '../../scripts/clean-room.mjs';

/**
 * Rule 2 of the build brief is enforced by a gate, not by care. A gate nobody has
 * watched fail is not a gate -- so every rule below is proven by planting a real
 * violation and asserting the scanner rejects it, with the legitimate shape asserted
 * beside it so the rule cannot pass by rejecting everything.
 *
 * Every planted value is assembled from fragments at runtime. That is not decoration:
 * if the violating strings appeared as literals, this file would itself be a
 * clean-room violation and `pnpm check:clean-room` would fail on the repository that
 * ships the gate. No committed line here matches any rule; the strings only exist in
 * memory while the test runs.
 */
const plant = (...fragments: string[]): string => fragments.join('');

describe('clean-room gate — foreign domains', () => {
  const foreignHost = plant('some-', 'operator', '-site', '.co', '.uk');

  it('fails on a domain that is not in the allowlist', () => {
    const violations = scanText(`Deployed at https://${foreignHost}/news`, 'docs/x.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('domain');
    expect(violations[0]?.match).toBe(foreignHost);
    expect(violations[0]?.line).toBe(1);
  });

  it('reports the correct line number in a multi-line file', () => {
    const text = ['# Title', '', 'ok line', `see https://${foreignHost}/page`].join('\n');
    const violations = scanText(text, 'docs/x.md');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it('passes RFC 2606 example domains, which is what demo content must use', () => {
    const text = [
      'https://example-news.example.com/article',
      'https://demo-journal.example.org',
      'editor@example.com',
      'http://localhost:4321/dheys-cms/',
    ].join('\n');
    expect(scanText(text, 'src/content/demo.md')).toEqual([]);
  });

  it('passes every allowlisted host the project genuinely calls', () => {
    const text = ALLOWED_DOMAINS.map((d: string) => `https://${d}/path`).join('\n');
    expect(scanText(text, 'docs/x.md').filter((v) => v.rule === 'domain')).toEqual([]);
  });

  it('does not mistake filenames and package paths for domains', () => {
    const text = [
      "import { defineConfig } from 'astro/config';",
      'astro.config.ts / vitest.config.ts / eslint.config.js',
      'see src/lib/paths.ts and tests/unit/paths.test.ts',
      'package.json, pnpm-lock.yaml, tokens.css, index.html',
    ].join('\n');
    expect(scanText(text, 'README.md')).toEqual([]);
  });

  it('allows a subdomain of an allowlisted host', () => {
    const text = 'https://raw.githubusercontent.com/a/b';
    expect(scanText(text, 'docs/x.md').filter((v) => v.rule === 'domain')).toEqual([]);
  });
});

describe('clean-room gate — where bare hostnames are read', () => {
  it('reads a bare hostname in prose', () => {
    const host = plant('an-operator', '-site', '.co');
    const violations = scanText(`We host the newsroom at ${host} today.`, 'docs/guide.md');
    expect(violations.map((v) => v.match)).toEqual([host]);
  });

  it('ignores a dotted code identifier in prose when it is written as inline code', () => {
    const text = 'Set `schedule.at` for a fixed time, or `record.to` to read the state.';
    expect(scanText(text, 'docs/automation.md')).toEqual([]);
  });

  it('does not read i18n message keys in JSON as hostnames', () => {
    const text = [
      '{',
      '  "article.by": "By {author}",',
      '  "admin.nav.media": "Media",',
      '  "pagination.page": "Page {current} of {total}"',
      '}',
    ].join('\n');
    expect(scanText(text, 'src/locales/en.json')).toEqual([]);
  });

  it('still reads a hostname in a JSON value', () => {
    const host = plant('operator', '-newsroom', '.org');
    const text = `  "homepage": "${host}"`;
    expect(scanText(text, 'package.json').map((v) => v.match)).toEqual([host]);
  });

  it('does not read member expressions in source files as hostnames', () => {
    const text = [
      'const due = item.schedule.at ?? item.publishedDate;',
      'return `${record.at.toISOString()} ${record.to} by ${record.actor.id}`;',
      "ctx.addIssue({ path: ['schedule', 'at'], message: 'schedule.at is required' });",
    ].join('\n');
    expect(scanText(text, 'src/lib/scheduler.ts')).toEqual([]);
  });

  it('scans a commit message as prose, since the history is committed too', () => {
    // The CLI passes `commit <sha>` as the pseudo-path. It has no extension, which is
    // what puts it in the prose set — this caught a real leak in the first commit.
    const host = plant('an-operator', '-domain', '.co');
    const violations = scanText(`fix: point the feed at ${host}`, 'commit d7d9a4360d');
    expect(violations.map((v) => v.match)).toEqual([host]);
  });

  it('allows the Co-Authored-By trailer that every commit here carries', () => {
    const trailer = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>';
    expect(scanText(trailer, 'commit d7d9a4360d')).toEqual([]);
  });

  it('reads a www-prefixed hostname even inside a source file', () => {
    const host = plant('www.', 'operator', '-site', '.com');
    const violations = scanText(`const SITE = '${host}';`, 'src/lib/config.ts');
    expect(violations.map((v) => v.match)).toEqual([host]);
  });

  it('reads a scheme-anchored hostname inside a source file', () => {
    const host = plant('operator', '-site', '.com');
    const violations = scanText(`fetch('https://${host}/api');`, 'src/lib/config.ts');
    expect(violations.map((v) => v.match)).toEqual([host]);
  });
});

describe('clean-room gate — foreign repository references', () => {
  it('fails on a GitHub repository that is not this one', () => {
    const foreignRepo = plant('someone', '-else', '/their', '-project');
    const violations = scanText(
      `git clone https://github.com/${foreignRepo}.git`,
      'README.md',
    ).filter((v) => v.rule === 'repo-reference');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.match).toBe(foreignRepo);
  });

  it("passes this project's own repository, with or without the .git suffix", () => {
    const text = [
      `https://github.com/${OWN_REPO.owner}/${OWN_REPO.repo}`,
      `https://github.com/${OWN_REPO.owner}/${OWN_REPO.repo}.git`,
    ].join('\n');
    expect(scanText(text, 'README.md').filter((v) => v.rule === 'repo-reference')).toEqual([]);
  });

  it('does not read GitHub product URLs as repository references', () => {
    const text = 'https://github.com/features/actions and https://github.com/settings/tokens';
    expect(scanText(text, 'docs/x.md').filter((v) => v.rule === 'repo-reference')).toEqual([]);
  });
});

describe('clean-room gate — credential shapes', () => {
  /**
   * Structurally valid, entirely invented, assembled at runtime. None of these
   * authenticates anything, and none of them appears as a literal in this file.
   */
  const planted: Array<[string, string]> = [
    ['GitHub classic PAT', plant('ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')],
    ['Anthropic key', plant('sk', '-ant-', 'api03-', 'ZZZZ1111YYYY2222XXXX3333WWWW4444')],
    ['Google key', plant('AI', 'za', 'Sy91b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')],
    ['AWS access key id', plant('AK', 'IA', 'Q7R8S9T0U1V2W3X4')],
    ['private key block', plant('-----', 'BEGIN RSA PRIVATE KEY', '-----')],
  ];

  it.each(planted)('fails on a planted %s', (_name, secret) => {
    const violations = scanText(`const key = "${secret}";`, 'src/lib/thing.ts').filter(
      (v) => v.rule === 'credential',
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('fails on an assigned secret literal', () => {
    const literal = plant('j4Kd82nfLp0q', 'WzXcVbNm55aa');
    const violations = scanText(
      `const config = { apiKey: "${literal}" };`,
      'src/lib/thing.ts',
    ).filter((v) => v.rule === 'credential');
    expect(violations).toHaveLength(1);
  });

  it('passes documented placeholders, which is what .env.example holds', () => {
    const text = [
      'ANTHROPIC_API_KEY=',
      'GITHUB_TOKEN=<your-fine-grained-pat>',
      'apiKey: "your-key-here"',
      'token: "${GITHUB_TOKEN}"',
      `apiKey: "${'x'.repeat(24)}"`,
    ].join('\n');
    expect(scanText(text, '.env.example').filter((v) => v.rule === 'credential')).toEqual([]);
  });

  it('does not flag the rule engine itself, which defines the shapes it looks for', () => {
    const secret = plant('sk', '-ant-', 'a'.repeat(28));
    const violations = scanText(secret, 'scripts/clean-room.mjs');
    expect(violations.filter((v) => v.rule === 'credential')).toEqual([]);
  });
});

describe('clean-room gate — reporting', () => {
  it('names the file, line and rule so a failure is actionable', () => {
    const host = plant('not-allowed', '-host', '.tv');
    const report = formatViolations(scanText(`https://${host}`, 'docs/guide.md'));
    expect(report).toContain('docs/guide.md:1');
    expect(report).toContain('domain');
    expect(report).toContain('1 violation(s)');
  });

  it('says so plainly when there is nothing to report', () => {
    expect(formatViolations([])).toBe('clean-room: no violations.');
  });

  it('collects violations of every rule from one file in a single pass', () => {
    const text = [
      `host: https://${plant('an-operator', '-domain', '.co')}`,
      `repo: https://github.com/${plant('other-owner', '/other-repo')}`,
      `key: "${plant('Q1w2E3r4T5y6', 'U7i8O9p0A1s2D3f4')}"`,
    ].join('\n');
    const rules = new Set(scanText(text, 'docs/x.md').map((v) => v.rule));
    expect(rules).toEqual(new Set(['domain', 'repo-reference', 'credential']));
  });
});
