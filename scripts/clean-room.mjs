/**
 * Clean-room scanner.
 *
 * Dheys CMS is a general-purpose product in a public repository. Nothing committed to
 * it may tie it to whoever happens to be building it: no operator-owned domain, no
 * other GitHub repository, no third-party account/project/deployment identifier, and
 * no credential in any shape.
 *
 * This module is the rule engine. `scripts/check-clean-room.mjs` is the CLI that runs
 * it over the working tree and the commit history, and CI runs that CLI on every push.
 * The engine is exported separately so tests can plant a violation and assert that the
 * gate actually rejects it -- a gate nobody has watched fail is not a gate.
 *
 * ALLOWLIST POLICY: this file is the single place a domain may be allowed. Add a host
 * here only if a committed file genuinely needs to name it (a standards body, the
 * toolchain's own documentation, a provider API endpoint the code calls, or an
 * RFC 2606 reserved example domain). Never add a host because a scan complained.
 */

/** Hosts a committed file is permitted to name. Exact host or `*.` suffix match. */
export const ALLOWED_DOMAINS = [
  // This project's own identity -- the only GitHub surface it may claim.
  'github.com',
  'api.github.com',
  'gist.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'nazilafeef.github.io',
  'pages.github.com',
  'docs.github.com',

  // RFC 2606 / RFC 6761 reserved names. All demo content must live here.
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'example.test',
  'example.invalid',
  'example.localhost',
  'localhost',

  // Standards and licence references.
  'schema.org',
  'www.schema.org',
  'w3.org',
  'www.w3.org',
  'opensource.org',
  'spdx.org',
  'unicode.org',
  'www.unicode.org',
  'creativecommons.org',
  'www.rfc-editor.org',
  'www.iana.org',
  'semver.org',
  'keepachangelog.com',
  'contributor-covenant.org',
  'www.contributor-covenant.org',
  'jsonfeed.org',
  'validator.w3.org',
  'developer.mozilla.org',

  // Toolchain documentation named in docs and code comments.
  'astro.build',
  'docs.astro.build',
  'nodejs.org',
  'pnpm.io',
  'vitejs.dev',
  'vitest.dev',
  'playwright.dev',
  'eslint.org',
  'prettier.io',
  'typescriptlang.org',
  'www.typescriptlang.org',
  'zod.dev',
  'pagefind.app',
  'developer.chrome.com',

  // Provider and host API endpoints the adapters actually call.
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.cloudflare.com',
  'api.netlify.com',
  'api.vercel.com',
];

/**
 * The one GitHub repository this project may reference.
 * @type {{owner: string, repo: string}}
 */
export const OWN_REPO = { owner: 'nazilafeef', repo: 'dheys-cms' };

/**
 * `github.com/<segment>/...` paths whose first segment is a GitHub product surface
 * rather than an account. Without this, `github.com/features/actions` reads as a
 * foreign repository reference.
 */
const GITHUB_NON_OWNER_SEGMENTS = new Set([
  'features', 'apps', 'marketplace', 'settings', 'orgs', 'pricing', 'about', 'security',
  'codespaces', 'sponsors', 'login', 'join', 'site', 'contact', 'enterprise', 'readme',
  'topics', 'search', 'new',
]);

/* ------------------------------------------------------------------ *
 * Domain detection
 * ------------------------------------------------------------------ *
 *
 * A naive "anything with dots" pattern reads `import.meta.url`, `record.at` and
 * `process.env.CI` as hostnames, and a gate that cries wolf on every dotted expression
 * gets switched off within a day. Detection is therefore split by how a hostname can
 * actually appear in a committed file:
 *
 *   1. ANCHORED  -- preceded by a scheme or an `@`. This is how a real domain almost
 *                   always appears, and it is scanned in EVERY file, including code.
 *   2. WWW       -- a `www.`-prefixed host, also scanned in every file. No code
 *                   identifier is spelled that way, so the prefix is unambiguous.
 *   3. BARE      -- a lowercase host with a real public suffix, scanned only in prose
 *                   files (Markdown, YAML, text) and in JSON *values*. Inline code
 *                   spans are stripped from prose first.
 *
 * Bare hostnames are deliberately NOT scanned inside source files. `schedule.at`,
 * `record.to`, `actor.id` and `admin.nav.media` are member expressions and i18n keys
 * whose suffixes all happen to be real public suffixes (.at Austria, .to Tonga,
 * .id Indonesia, .media), and there is no reliable way to tell them from a hostname in
 * a code string. Scanning them produced pages of noise on the first run.
 *
 * The residual gap is a hostname hard-coded bare, with no scheme and no `www.`, inside
 * a source-file string literal -- e.g. `const SITE = 'somewhere.co'`. Every other form
 * is covered, and site configuration in this project lives in YAML/JSON/Markdown, all
 * of which are scanned in full. This trade-off is recorded in docs/DECISIONS.md.
 */

const HOST = '(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,24}';

/** Scheme- or `@`-anchored hostname. Scanned in every file. */
const ANCHORED_DOMAIN_RE = new RegExp(`(?:https?://|//|@)(${HOST})`, 'gi');

/** Bare hostname. Scanned only in prose and JSON values. */
const BARE_DOMAIN_RE = new RegExp(`(?<![\\w.@/-])(${HOST})(?![\\w-])`, 'g');

/** `www.`-prefixed hostname. Unambiguous, so scanned everywhere. */
const WWW_DOMAIN_RE = new RegExp(`(?<![\\w.@/-])(www\\.${HOST})(?![\\w-])`, 'gi');

/**
 * Public suffixes a bare hostname may end in. Deliberately a real list rather than
 * `[a-z]{2,}`: it is what separates `demo-journal.example.org` from `import.meta.url`.
 */
const KNOWN_TLDS = new Set(
  (
    // ISO 3166-1 alpha-2 country codes.
    'ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm ' +
    'bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz ' +
    'de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl ' +
    'gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je ' +
    'jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc ' +
    'md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl ' +
    'no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa ' +
    'sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk ' +
    'tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za ' +
    'zm zw ' +
    // Generic and sponsored TLDs seen in the wild.
    'com net org info biz name pro mobi tel asia travel jobs cat coop museum aero int ' +
    'edu gov mil post app dev page new link click site online store shop blog cloud ' +
    'tech space website digital agency studio design email host network systems ' +
    'solutions services group team work ltd inc llc plus wiki cool best top vip win ' +
    'media news press today world live life fun run art build xyz icu one global ' +
    'center company city careers finance fund gallery guru institute ninja rocks ' +
    'social software tips tools training video works academy capital care cash chat ' +
    'clinic coffee community computer consulting delivery directory education energy ' +
    'engineering estate events exchange expert express fashion fitness football ' +
    'foundation gifts gold golf green guide holdings house industries insure ' +
    'investments kitchen land legal lighting limited loans management market ' +
    'marketing money movie partners parts photo photography photos pictures pizza ' +
    'place productions properties pub recipes rentals repair report rest restaurant ' +
    'sale school shopping show ski soccer solar style supply support systems tax taxi ' +
    'technology tennis theater tours town toys university vacations ventures vision ' +
    'watch weather wedding wine yoga zone'
  ).split(/\s+/),
);

/**
 * Suffixes that are TLD-shaped but, in this repository, are overwhelmingly file
 * extensions. `.md` is Moldova and `.ts` is Sao Tome, but `STATE.md` and `paths.ts`
 * are not hostnames.
 */
const NON_DOMAIN_SUFFIXES = new Set([
  'ts', 'js', 'mjs', 'cjs', 'json', 'md', 'mdx', 'css', 'scss', 'html', 'htm', 'xml',
  'yml', 'yaml', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'ico', 'txt',
  'lock', 'toml', 'sh', 'ps1', 'py', 'rb', 'go', 'rs', 'java', 'php', 'sql', 'env',
  'map', 'test', 'spec', 'config', 'min', 'log', 'zip', 'bundle', 'tar', 'gz',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'csv', 'tsv', 'bak', 'tmp', 'example',
  'local', 'astro', 'vue', 'jsx', 'tsx', 'npmrc', 'nvmrc', 'gitignore', 'mts', 'cts',
]);

/** Extensions whose prose may legitimately contain a bare hostname. */
const PROSE_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.yml', '.yaml', '.html', '.csv', '.example', '',
]);

/** File extensions that are never scanned as text. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.pdf', '.zip', '.gz',
  '.bundle', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3',
  '.wasm', '.node', '.exe', '.dll',
]);

/* ------------------------------------------------------------------ *
 * Credential detection
 * ------------------------------------------------------------------ */

const CREDENTIAL_PATTERNS = [
  { name: 'GitHub personal access token (classic)', re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { name: 'GitHub OAuth/app/refresh token', re: /\bgh[osur]_[A-Za-z0-9]{36}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Private key block', re: /-{5}BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-{5}/g },
  {
    name: 'JSON Web Token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: 'Assigned secret literal',
    re: /\b(?:api[_-]?key|apikey|key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|token|password|passwd|credential)\b\s*[:=]\s*["'`]([A-Za-z0-9_\-./+]{16,})["'`]/gi,
    entropyGuarded: true,
  },
];

/**
 * A long string assigned to something called `key` or `token` is usually a config
 * value, not a secret: CSS class names, slugs and i18n keys all match that shape. Real
 * credentials mix character classes. Requiring three of the four classes (or a long
 * unbroken base64 run) keeps the rule useful without drowning the gate in noise --
 * `"article-list-item"` passes, `"j4Kd82nfLp0qWzXcVbNm55aa"` does not.
 *
 * @param {string} value
 */
function looksHighEntropy(value) {
  if (value.length < 16) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[_\-./+]/].filter((re) => re.test(value)).length;
  if (classes >= 3) return true;
  return value.length >= 32 && /^[A-Za-z0-9+/=]+$/.test(value);
}

/**
 * Placeholder values that look like an assigned secret but are documentation.
 * Kept deliberately tiny; anything longer belongs in `.env.example` as an empty value.
 */
const CREDENTIAL_PLACEHOLDER =
  /(?:x{8,}|\.{3}|<[^>]+>|\$\{[^}]+\}|\byour[-_]|example|placeholder|replace[-_]?me|redacted|dummy|sample|changeme|token-goes-here)/i;

/** Files exempt from the credential-shape rule because they *define* the shapes. */
const CREDENTIAL_RULE_EXEMPT = new Set(['scripts/clean-room.mjs']);

/* ------------------------------------------------------------------ *
 * Scanner
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} Violation
 * @property {'domain'|'repo-reference'|'credential'} rule
 * @property {string} file
 * @property {number} line     1-indexed
 * @property {string} match    the offending text
 * @property {string} detail   plain-language explanation
 */

/** @param {string} file */
export function isBinaryPath(file) {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(file.slice(dot).toLowerCase());
}

/** @param {string} file */
function extensionOf(file) {
  const base = file.split('/').pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** @param {string} host */
function isAllowedDomain(host) {
  const lower = host.toLowerCase().replace(/\.$/, '');
  if (ALLOWED_DOMAINS.includes(lower)) return true;
  return ALLOWED_DOMAINS.some((allowed) => lower.endsWith(`.${allowed}`));
}

/** @param {string} candidate */
function suffixOf(candidate) {
  return candidate.slice(candidate.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * Quoted string literals on a line. A hostname hard-coded in TypeScript lives in one of
 * these; a member-access expression never does.
 * @param {string} line
 * @returns {string[]}
 */
function stringLiterals(line) {
  const found = [];
  const re = /'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g;
  for (const match of line.matchAll(re)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) found.push(value);
  }
  return found;
}

/** Strip inline code spans so `schedule.at` in prose is not read as a hostname. */
function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, ' ');
}

/**
 * String values on a JSON line, with the key dropped.
 *
 * i18n message keys are dotted by design -- `admin.nav.media`, `article.by`,
 * `pagination.page` -- and every one of those suffixes is a real public TLD. The key
 * side of a JSON line is structure, never content, so only the value is scanned. The
 * anchored rule still runs over the whole line, so a URL in a key would not slip past.
 *
 * @param {string} line
 */
function jsonValueLiterals(line) {
  const withoutKey = line.replace(/^\s*"(?:[^"\\]|\\.)*"\s*:/, '');
  return stringLiterals(withoutKey);
}

/**
 * Scan one file's text. Pure and synchronous so tests can call it with a planted
 * violation instead of writing to disk.
 *
 * @param {string} text
 * @param {string} file  repo-relative path, used for reporting and rule exemptions
 * @returns {Violation[]}
 */
export function scanText(text, file) {
  /** @type {Violation[]} */
  const violations = [];
  const lines = text.split(/\r?\n/);
  const normalisedFile = file.replace(/\\/g, '/');
  const credentialExempt = CREDENTIAL_RULE_EXEMPT.has(normalisedFile);
  const extension = extensionOf(normalisedFile);
  const isProse = PROSE_EXTENSIONS.has(extension);
  const isJson = extension === '.json';

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const seenOnLine = new Set();

    /** @param {string} host */
    const reportDomain = (host) => {
      const lower = host.toLowerCase();
      if (seenOnLine.has(lower)) return;
      seenOnLine.add(lower);
      violations.push({
        rule: 'domain',
        file: normalisedFile,
        line: lineNumber,
        match: host,
        detail: `"${host}" is not in ALLOWED_DOMAINS. Committed files may not name a real host outside the allowlist -- use an example.* domain for demo content.`,
      });
    };

    // Rule 1a -- scheme- or @-anchored hostnames, in every file.
    for (const match of line.matchAll(ANCHORED_DOMAIN_RE)) {
      const host = match[1];
      if (!host) continue;
      if (NON_DOMAIN_SUFFIXES.has(suffixOf(host))) continue;
      if (isAllowedDomain(host)) continue;
      reportDomain(host);
    }

    // Rule 1b -- bare hostnames, where a bare hostname is plausible.
    const bareSources = isJson
      ? jsonValueLiterals(line)
      : isProse
        ? [stripInlineCode(line)]
        : [];
    for (const source of bareSources) {
      for (const match of source.matchAll(BARE_DOMAIN_RE)) {
        const host = match[1];
        if (!host) continue;
        if (host !== host.toLowerCase()) continue;
        const suffix = suffixOf(host);
        if (!KNOWN_TLDS.has(suffix)) continue;
        if (NON_DOMAIN_SUFFIXES.has(suffix)) continue;
        if (isAllowedDomain(host)) continue;
        reportDomain(host);
      }
    }

    // Rule 1c -- `www.`-prefixed hosts anywhere, including source files. The prefix is
    // unambiguous: no code identifier is spelled `www.something`.
    for (const match of line.matchAll(WWW_DOMAIN_RE)) {
      const host = match[1];
      if (!host) continue;
      if (isAllowedDomain(host)) continue;
      reportDomain(host);
    }

    // Rule 2 -- foreign GitHub repositories.
    const repoRe = /github\.com\/([A-Za-z0-9][A-Za-z0-9-_.]*)\/([A-Za-z0-9][A-Za-z0-9-_.]*)/g;
    for (const match of line.matchAll(repoRe)) {
      const owner = match[1];
      const repoRaw = match[2];
      if (!owner || !repoRaw) continue;
      if (GITHUB_NON_OWNER_SEGMENTS.has(owner.toLowerCase())) continue;
      const repo = repoRaw.replace(/\.git$/, '');
      if (owner === OWN_REPO.owner && repo === OWN_REPO.repo) continue;
      violations.push({
        rule: 'repo-reference',
        file: normalisedFile,
        line: lineNumber,
        match: `${owner}/${repo}`,
        detail: `Only ${OWN_REPO.owner}/${OWN_REPO.repo} may be referenced. Found "${owner}/${repo}".`,
      });
    }

    // Rule 3 -- credential shapes.
    if (!credentialExempt) {
      for (const { name, re, entropyGuarded } of CREDENTIAL_PATTERNS) {
        for (const match of line.matchAll(re)) {
          const hit = match[0];
          if (CREDENTIAL_PLACEHOLDER.test(hit)) continue;
          if (entropyGuarded && !looksHighEntropy(match[1] ?? '')) continue;
          violations.push({
            rule: 'credential',
            file: normalisedFile,
            line: lineNumber,
            match: `${hit.slice(0, 12)}...`,
            detail: `Looks like a ${name}. No credential may be committed in any form.`,
          });
        }
      }
    }
  });

  return violations;
}

/**
 * Render violations as an operator-readable report.
 * @param {Violation[]} violations
 */
export function formatViolations(violations) {
  if (violations.length === 0) return 'clean-room: no violations.';
  const byRule = new Map();
  for (const v of violations) {
    const list = byRule.get(v.rule) ?? [];
    list.push(v);
    byRule.set(v.rule, list);
  }
  const parts = [`clean-room: ${violations.length} violation(s).`, ''];
  for (const [rule, list] of byRule) {
    parts.push(`  ${rule} (${list.length}):`);
    for (const v of list) {
      parts.push(`    ${v.file}:${v.line}  ${v.match}`);
      parts.push(`      ${v.detail}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}
