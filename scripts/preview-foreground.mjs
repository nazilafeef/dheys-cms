#!/usr/bin/env node
/**
 * A preview server that stays in the foreground, for tools that expect one.
 *
 * Playwright's `webServer` needs a process that lives as long as the server does: it
 * starts the command, waits for `url` to answer, runs the suite, then kills what it
 * started. Astro 7's `preview` daemonises instead, so Playwright saw its command exit
 * immediately and reported "Process from config.webServer exited early" without running a
 * single test.
 *
 * This wrapper restores the shape Playwright expects. It starts the daemon, waits for the
 * URL to serve, then blocks; when it is asked to stop, it stops the daemon too. On Windows
 * a killed process gets no chance to clean up, so `tests/e2e/global-teardown.ts` stops the
 * daemon as well --- whichever runs first, nothing is left listening.
 *
 *   node scripts/preview-foreground.mjs --port 4321 --host 127.0.0.1 --url http://.../
 */
import { setInterval } from 'node:timers';

import { startPreview, stopPreviewSync } from './preview-control.mjs';

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const port = Number(readFlag('--port', '4321'));
const host = readFlag('--host', '127.0.0.1');
const url = readFlag('--url', `http://${host}:${port}/`);

let stopping = false;
const shutdown = (code) => {
  if (stopping) return;
  stopping = true;
  stopPreviewSync();
  process.exit(code);
};

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => shutdown(0));
}
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(1);
});

await startPreview({ port, host, url });
process.stdout.write(`preview-foreground: serving ${url}\n`);

// Hold the process open. Playwright kills it when the run finishes.
setInterval(() => {}, 1 << 30);
