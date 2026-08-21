import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The history half of the clean-room gate.
 *
 * DECISIONS #46 recorded a real gap: the release archive was verified by unzipping it into
 * a gitignored path inside this repository, and a zip carries no `.git`, so every git-aware
 * check resolved upward and read *this* repository's commit history while reporting on the
 * archive. `pnpm verify:release` now clones the bundle instead, which produces a genuine
 * standalone repository.
 *
 * This test is the proof, and it is built to be unambiguous. A synthetic repository is
 * created with a commit count chosen to be small and fixed -- three -- so it cannot
 * coincide with this repository's, which only grows. The gate's own scripts are copied in
 * and run there. If the gate reported the enclosing history it would say fourteen or more;
 * saying exactly three is only possible by reading the repository it was actually run in.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SANDBOX = join(ROOT, '.tmp', 'history-proof');
const REPO = join(SANDBOX, 'synthetic');
const COMMITS = 3;

/** @param argv git arguments, run inside the synthetic repository unless told otherwise */
function git(argv: readonly string[], cwd: string = REPO): string {
  // stderr is captured rather than inherited: on Windows git narrates every line-ending
  // conversion, and a test run should not have to be read around that.
  return execFileSync('git', [...argv], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('clean-room gate — whose history it reads', () => {
  let created = false;

  beforeAll(() => {
    rmSync(SANDBOX, { recursive: true, force: true });
    mkdirSync(join(REPO, 'scripts'), { recursive: true });

    // A repository of its own, so git stops here rather than walking up to ours.
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'user.email', 'build@example.com']);
    git(['config', 'user.name', 'Build']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);

    // The gate is two files and reads nothing else, so copying them in is enough to run it
    // exactly as it runs here.
    for (const script of ['clean-room.mjs', 'check-clean-room.mjs']) {
      copyFileSync(join(ROOT, 'scripts', script), join(REPO, 'scripts', script));
    }

    for (let i = 1; i <= COMMITS; i += 1) {
      writeFileSync(join(REPO, `note-${i}.md`), `# Note ${i}\n\nNothing here breaks any rule.\n`);
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', `chore: note ${i}`]);
    }
    created = true;
  });

  afterAll(() => {
    // Best effort. The directory is gitignored and skipped by every other tool, so a file
    // lock left by a virus scanner is not worth failing a test run over.
    try {
      rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      /* empty */
    }
  });

  const runGate = (): { status: number | null; out: string } => {
    const result = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-clean-room.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  it('builds a synthetic repository whose commit count cannot be mistaken for ours', () => {
    expect(created).toBe(true);
    expect(Number(git(['rev-list', '--count', '--all']))).toBe(COMMITS);

    const ours = Number(git(['rev-list', '--count', '--all'], ROOT));
    expect(ours).toBeGreaterThan(COMMITS);
  });

  it('reports the commit count of the repository it was run in, not the enclosing one', () => {
    const { status, out } = runGate();
    expect(status).toBe(0);
    expect(out).toContain(`plus ${COMMITS} commit message(s)`);

    const ours = Number(git(['rev-list', '--count', '--all'], ROOT));
    expect(out).not.toContain(`plus ${ours} commit message(s)`);
  });

  it('still fails on a planted violation inside that repository', () => {
    // The gate reading the right history is worth nothing if it has stopped detecting
    // anything, so the positive case is proven in the same sandbox.
    const host = ['some-operator', '-site', '.co', '.uk'].join('');
    writeFileSync(join(REPO, 'leak.md'), `Deployed at https://${host}/news\n`);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'chore: add a note']);

    const { status, out } = runGate();
    expect(status).toBe(1);
    expect(out).toContain('leak.md');
    expect(out).toContain('domain');

    // Leave the sandbox as we found it for any later assertion.
    rmSync(join(REPO, 'leak.md'), { force: true });
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'chore: remove a note']);
  });
});
