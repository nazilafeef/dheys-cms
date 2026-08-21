/**
 * Stop the preview daemon when the suite finishes.
 *
 * `scripts/preview-foreground.mjs` also stops it on signal, but on Windows Playwright
 * terminates its web server without giving it a chance to run an exit handler, and Astro 7's
 * preview is a detached daemon that survives its parent. Without this, a run left a server
 * listening that then served a stale build to the next one.
 */
import { stopPreview } from '../../scripts/preview-control.mjs';

export default async function globalTeardown(): Promise<void> {
  await stopPreview();
}
