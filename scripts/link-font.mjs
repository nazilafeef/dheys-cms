#!/usr/bin/env node
/**
 * Point a local install at Thaana font files kept outside this repository.
 *
 * This repository ships no font binary and must not — see docs/FONTS.md for the licensing
 * position, which is genuinely unresolved rather than merely unaddressed. What this script
 * does is write a *gitignored* pointer to files the operator already has a licence for,
 * copying them into `src/assets/fonts/` (also gitignored) so the build can serve them.
 *
 * Nothing it writes is committable. That is the point.
 *
 *   pnpm link-font --from "C:/fonts/their-face"      copy every .woff2 found there
 *   pnpm link-font --from ./fonts --name my-thaana   name the family explicitly
 *   pnpm link-font --clear                           unlink, and delete what was copied
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { basename, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONT_DIR = join(ROOT, 'src/assets/fonts');
const POINTER = join(ROOT, 'font-path.local.json');

const args = parseArgs(process.argv.slice(2));

if (args['clear'] === 'true') {
  rmSync(POINTER, { force: true });
  rmSync(FONT_DIR, { recursive: true, force: true });
  console.log('link-font: cleared. The theme falls back to system Thaana faces.');
  process.exit(0);
}

const from = args['from'];
if (!from) {
  console.error(
    'link-font: pass --from <directory containing .woff2 files>, or --clear to unlink.\n' +
      '\n' +
      'This repository ships no font binary. See docs/FONTS.md for why, and for what is\n' +
      'still unresolved about the licence.',
  );
  process.exit(1);
}

if (!existsSync(from) || !statSync(from).isDirectory()) {
  console.error(`link-font: ${from} is not a directory.`);
  process.exit(1);
}

const sources = readdirSync(from).filter((file) =>
  ['.woff2', '.woff'].includes(extname(file).toLowerCase()),
);

if (sources.length === 0) {
  console.error(
    `link-font: no .woff2 or .woff files in ${from}.\n` +
      'Convert the face first — a static site should not be serving a .ttf.',
  );
  process.exit(1);
}

// Prefer woff2: roughly 30% smaller than woff, and universally supported by anything that
// can render Thaana at all.
const preferred = sources.find((file) => extname(file).toLowerCase() === '.woff2') ?? sources[0];

mkdirSync(FONT_DIR, { recursive: true });
const destination = join(FONT_DIR, basename(preferred));
copyFileSync(join(from, preferred), destination);

const family = args['name'] ?? 'Dheys Thaana';
const publicUrl = `/fonts/${basename(preferred)}`;

writeFileSync(
  POINTER,
  `${JSON.stringify(
    {
      family,
      file: basename(preferred),
      url: publicUrl,
      linkedFrom: from,
      linkedAt: new Date().toISOString(),
      note: 'Written by `pnpm link-font`. Gitignored on purpose: no font binary or licensed path belongs in this repository.',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`link-font: linked ${preferred} as "${family}".`);
console.log(`  copied to  src/assets/fonts/${basename(preferred)}  (gitignored)`);
console.log(`  pointer    font-path.local.json                     (gitignored)`);
console.log('');
console.log('Add this to your theme, or to a stylesheet the theme imports:');
console.log('');
console.log(`  :root { --thaana-font-url: url('${publicUrl}'); }`);
console.log('');
console.log('And preload it in the document head, since Thaana has almost no system fallback:');
console.log('');
console.log(`  <link rel="preload" as="font" type="font/woff2" href="${publicUrl}" crossorigin />`);
console.log('');
console.log('The metric contract the slot expects is documented in themes/dheys/fonts.css.');

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
