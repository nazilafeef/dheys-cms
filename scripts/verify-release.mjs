/**
 * Release verification.
 *
 * Builds `release/dheys-cms-v1.0.0.zip` and `.bundle` from HEAD, then proves the artefacts
 * by running the gate against them rather than against the tree they came from.
 *
 * ── Why this clones the bundle instead of unzipping the zip ─────────────────────────────
 *
 * The first version of this verification unzipped the archive into a gitignored path and
 * ran the gate there. That was wrong in a way that took a while to see. A zip carries no
 * `.git`, and the build brief forbids creating working copies outside the working
 * directory, so the unpacked copy necessarily sat *inside* this repository. Every
 * git-aware command therefore resolved upward: `check-clean-room` reported this
 * repository's commit history while claiming to have verified the archive's. The file scan
 * was honest -- `git ls-files` returns nothing in an ignored subdirectory, so the gate fell
 * through to its filesystem walk and covered exactly the archive's files -- but the history
 * half of the check was reading something else entirely.
 *
 * The bundle fixes it, because a bundle *is* history. Cloning it produces a genuine
 * standalone repository with its own `.git`, so git commands inside it resolve to it and
 * stop at its boundary. The clone can sit inside this repository without borrowing
 * anything from it.
 *
 * The assertion below is what makes that a proof rather than a hope: the number of commits
 * `check-clean-room` reports must equal the clone's own commit count. When this repository
 * has moved on since the bundle was cut -- the normal case, since packaging is followed by
 * committing the report -- the two counts differ, and reading the wrong history is then
 * detectable rather than merely unlikely.
 *
 * The zip is still verified, by asserting its file list matches the clone's tracked files
 * exactly. If the two artefacts disagree about what ships, that is worth failing over.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = '1.0.0';
const RELEASE_DIR = join(ROOT, 'release');
const ZIP = join(RELEASE_DIR, `dheys-cms-v${VERSION}.zip`);
const BUNDLE = join(RELEASE_DIR, `dheys-cms-v${VERSION}.bundle`);
const WORK = join(ROOT, '.tmp', 'release-verify');
// A fresh directory per run. Windows keeps handles open on a tree that was just built and
// served -- a scanner, an editor watcher, a browser that has not finished exiting -- and a
// verification script that cannot start because the *last* run's copy is still locked is a
// broken gate. Old runs are pruned when they let go, and ignored when they do not.
const CLONE = join(
  WORK,
  `clone-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)}`,
);

const args = new Set(process.argv.slice(2));
/** Skip the slow gates. The history proof, which is the point of this script, still runs. */
const quick = args.has('--quick');

/** @param {string[]} argv @param {string} [cwd] */
function git(argv, cwd = ROOT) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

/** @param {string} message */
function step(message) {
  console.log(`\n== ${message}`);
}

/** @param {string} label @param {boolean} ok @param {string} detail */
function assert(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

/** Every file in the zip, archive prefix stripped, directories dropped. */
function zipEntries() {
  const out = execFileSync('node', ['-e', ZIP_LIST_SCRIPT, ZIP], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean).sort();
}

/**
 * Read the central directory of a zip without shelling out to `unzip`, which is not present
 * on every machine this has to run on. Only the file names are needed.
 */
const ZIP_LIST_SCRIPT = `
const { readFileSync } = require('node:fs');
const buf = readFileSync(process.argv[1]);
// End of central directory record: signature 0x06054b50, scanned from the tail.
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i -= 1) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.error('not a zip'); process.exit(1); }
let count = buf.readUInt16LE(eocd + 10);
let offset = buf.readUInt32LE(eocd + 16);
const names = [];
for (let i = 0; i < count; i += 1) {
  if (buf.readUInt32LE(offset) !== 0x02014b50) break;
  const nameLen = buf.readUInt16LE(offset + 28);
  const extraLen = buf.readUInt16LE(offset + 30);
  const commentLen = buf.readUInt16LE(offset + 32);
  const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
  if (!name.endsWith('/')) names.push(name.replace(/^dheys-cms-v[0-9.]+\\//, ''));
  offset += 46 + nameLen + extraLen + commentLen;
}
console.log(names.join('\\n'));
`;

/** @param {string} script @param {string[]} [extra] */
function runGate(script, extra = []) {
  const started = Date.now();
  const result = spawnSync('pnpm', [script, ...extra], {
    cwd: CLONE,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert(`pnpm ${script}`, result.status === 0, `exit=${result.status}, ${seconds}s`);
  if (result.status !== 0) console.log(output.split('\n').slice(-25).join('\n'));
  return output;
}

function main() {
  const head = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']);
  console.log(`verify-release: HEAD ${head}${dirty ? ' (working tree DIRTY)' : ''}`);
  assert('working tree is clean', dirty === '', dirty ? 'commit or stash first' : '');

  // ── build the artefacts ──────────────────────────────────────────────────────────────
  step('building artefacts from HEAD');
  mkdirSync(RELEASE_DIR, { recursive: true });
  rmSync(ZIP, { force: true });
  rmSync(BUNDLE, { force: true });
  git(['archive', '--format=zip', `--prefix=dheys-cms-v${VERSION}/`, '-o', ZIP, 'HEAD']);
  git(['bundle', 'create', BUNDLE, '--all']);
  assert('zip written', existsSync(ZIP), ZIP.replace(ROOT, ''));
  assert('bundle written', existsSync(BUNDLE), BUNDLE.replace(ROOT, ''));

  // ── clone the bundle: a real repository, with its own history ────────────────────────
  step('cloning the bundle into a standalone repository');
  mkdirSync(WORK, { recursive: true });
  for (const stale of readdirSync(WORK)) {
    try {
      rmSync(join(WORK, stale), { recursive: true, force: true });
    } catch {
      // Still locked. Harmless: the directory is gitignored, skipped by every gate, and the
      // run below uses its own.
    }
  }
  git(['clone', '--quiet', BUNDLE, CLONE], WORK);

  const cloneGitDir = join(CLONE, '.git');
  assert('the clone has its own .git', existsSync(cloneGitDir), '');
  const cloneTop = git(['rev-parse', '--show-toplevel'], CLONE);
  assert(
    'git inside the clone resolves to the clone, not the outer repository',
    cloneTop.replace(/\\/g, '/').toLowerCase().endsWith('/.tmp/release-verify/clone'),
    cloneTop,
  );

  // ── the history proof ────────────────────────────────────────────────────────────────
  //
  // Two assertions, because the obvious one is not always decisive. Comparing the reported
  // count against the clone's own proves nothing on a run where this repository happens to
  // sit at the same number -- which it does immediately after packaging, before the report
  // is committed. So the clone is also given a marker commit on a throwaway branch: the
  // count it alone can see moves by exactly one, and a gate reading our history would not
  // follow. The marker is removed afterwards and the count checked back down again, so the
  // artefact is left exactly as it will ship.
  step('proving the clean-room gate reads the clone history, not this one');

  /** Run the gate inside the clone and return its summary line and the count it reports. */
  const gateInClone = () => {
    const result = spawnSync('node', [join(CLONE, 'scripts', 'check-clean-room.mjs')], {
      cwd: CLONE,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const line = text.split('\n').pop() ?? '';
    const match = /plus (\d+) commit message\(s\)/.exec(text);
    return { status: result.status, line, count: match ? Number(match[1]) : null };
  };

  const cloneCommits = Number(git(['rev-list', '--count', '--all'], CLONE));
  const outerCommits = Number(git(['rev-list', '--count', '--all']));
  console.log(`  bundle/clone commits : ${cloneCommits}`);
  console.log(`  this repository      : ${outerCommits}`);

  const before = gateInClone();
  console.log(`  gate says            : ${before.line}`);
  assert('clean-room passes in the clone', before.status === 0, `exit=${before.status}`);
  assert('the gate reports a commit count at all', before.count !== null, before.line);
  assert(
    'reported count equals the bundle own history',
    before.count === cloneCommits,
    `${before.count} == ${cloneCommits}`,
  );

  // The marker. An empty commit on a detached branch: HEAD, the worktree and the tracked
  // file set are all untouched, so nothing being verified changes -- only the history the
  // gate can see from inside the clone.
  const MARKER_BRANCH = 'release-verify-history-probe';
  git(['branch', MARKER_BRANCH], CLONE);
  git(
    [
      '-c',
      'user.email=verify@example.com',
      '-c',
      'user.name=Release Verify',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--allow-empty',
      '--only',
      '-m',
      'chore: history probe, removed before this script exits',
    ],
    CLONE,
  );
  git(['branch', '-f', MARKER_BRANCH, 'HEAD'], CLONE);
  git(['reset', '--quiet', '--hard', 'HEAD~1'], CLONE);

  const probed = Number(git(['rev-list', '--count', '--all'], CLONE));
  const during = gateInClone();
  console.log(`  with a marker commit : ${during.line}`);
  assert('the marker moved the clone history by one', probed === cloneCommits + 1, `${probed}`);
  assert(
    'the gate followed the clone, not this repository',
    during.count === probed && during.count !== outerCommits,
    `${during.count} == ${probed}, and != ${outerCommits}`,
  );

  // Put it back, and prove it went back.
  git(['branch', '-D', MARKER_BRANCH], CLONE);
  git(['reflog', 'expire', '--expire=now', '--all'], CLONE);
  git(['gc', '--prune=now', '--quiet'], CLONE);
  const after = gateInClone();
  assert(
    'the clone is left exactly as it will ship',
    Number(git(['rev-list', '--count', '--all'], CLONE)) === cloneCommits &&
      after.count === cloneCommits,
    `${after.count} == ${cloneCommits}`,
  );

  // ── the zip agrees with the bundle about what ships ──────────────────────────────────
  step('checking the zip and the bundle ship the same files');
  const tracked = git(['ls-files'], CLONE).split('\n').filter(Boolean).sort();
  const zipped = zipEntries();
  const onlyZip = zipped.filter((f) => !tracked.includes(f));
  const onlyClone = tracked.filter((f) => !zipped.includes(f));
  assert(
    'zip file list matches the clone tracked files',
    onlyZip.length === 0 && onlyClone.length === 0,
    `${zipped.length} files`,
  );
  if (onlyZip.length) console.log('   only in zip:', onlyZip.slice(0, 10).join(', '));
  if (onlyClone.length) console.log('   only in clone:', onlyClone.slice(0, 10).join(', '));

  const forbidden = zipped.filter(
    (f) => f.startsWith('node_modules/') || f.startsWith('dist/') || f.startsWith('.git/'),
  );
  assert(
    'zip excludes node_modules, dist and .git',
    forbidden.length === 0,
    `${forbidden.length} found`,
  );

  // ── the full gate, in the clone ──────────────────────────────────────────────────────
  step(quick ? 'running the fast gates in the clone' : 'running the full gate in the clone');
  runGate('install', ['--frozen-lockfile']);
  runGate('typecheck');
  runGate('lint');
  runGate('test');
  runGate('build');
  runGate('check:links');
  if (!quick) {
    runGate('test:e2e');
    runGate('lighthouse');
  }

  step(process.exitCode ? 'FAILED' : 'OK');
  if (!process.exitCode) {
    console.log(`  ${zipped.length} files, ${cloneCommits} commits, verified from the bundle.`);
  }
}

main();
