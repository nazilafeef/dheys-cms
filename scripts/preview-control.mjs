/**
 * Start and stop the preview server.
 *
 * Astro 7 turned `astro preview` into a daemon: it forks, prints where it landed, and the
 * command you invoked exits 0 immediately. Two things in this repository assumed the old
 * behaviour of a process that blocks until killed --- Playwright's `webServer`, which
 * reported "Process from config.webServer exited early" and never ran a test, and the
 * Lighthouse gate, which called `.kill()` on a process that had already exited and left the
 * real server running afterwards.
 *
 * Rather than fight the daemon, this module drives it: start it, wait until it actually
 * answers, and stop it through Astro's own `preview stop`, which knows the pid it wrote
 * down. Stopping is deliberately routed through the CLI rather than a pid we guess at,
 * because the process that needs killing is not the one we spawned.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/*
 * Astro's CLI entry point, read from its own manifest rather than hard-coded. The path
 * moved between majors -- `astro/astro.js` in 5, `astro/bin/astro.mjs` in 7 -- and a
 * guessed path fails as MODULE_NOT_FOUND from inside a web-server wrapper, which is a
 * long way from where the real problem is.
 */
const require = createRequire(import.meta.url);
const ASTRO_BIN = join(
  dirname(require.resolve('astro/package.json')),
  require('astro/package.json').bin.astro,
);

/** Astro's CLI, invoked the same way on every platform. */
const astro = (args, options = {}) =>
  execFileAsync(process.execPath, [ASTRO_BIN, ...args], {
    cwd: ROOT,
    ...options,
  });

/**
 * Stop any running preview daemon. Safe to call when none is running.
 *
 * Synchronous by default so it can be used from an exit handler, where a promise would
 * never be awaited.
 */
export function stopPreviewSync() {
  try {
    execFileSync(process.execPath, [ASTRO_BIN, 'preview', 'stop'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  } catch {
    /* nothing was running, or the CLI is gone; either way there is nothing to stop */
  }
}

export async function stopPreview() {
  try {
    await astro(['preview', 'stop']);
  } catch {
    /* nothing was running */
  }
}

async function answers(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the preview daemon and wait until `url` actually serves.
 *
 * The wait is on a real response rather than on the CLI's output: the daemon prints its
 * address before it is necessarily ready, and on this host it has been observed to report
 * a port one higher than the one it was given while still serving correctly on the
 * requested one. What the caller needs to know is that the URL it will use works.
 */
export async function startPreview({ port, host = '127.0.0.1', url, timeoutMs = 120_000 }) {
  // A leftover daemon serves a previous build, and the failures that produces are
  // extremely misleading. Always begin from nothing running.
  await stopPreview();

  await astro(['preview', '--port', String(port), '--host', host]);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await stopPreview();
  throw new Error(`preview did not answer at ${url} within ${timeoutMs}ms`);
}
