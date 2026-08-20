import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import mdx from '@astrojs/mdx';

import { normaliseBase } from './src/lib/paths';

/**
 * Both hosting modes are first-class:
 *
 *   Project page (default):  SITE_URL=https://nazilafeef.github.io  BASE_PATH=/dheys-cms
 *   Root / apex hosting:     SITE_URL=https://cms.example.test      BASE_PATH=/
 *
 * `normaliseBase` is shared with the runtime helpers in src/lib/paths.ts so the
 * build and the rendered markup can never disagree about what the base is.
 */
const SITE_URL = process.env.SITE_URL ?? 'https://nazilafeef.github.io';
const BASE_PATH = normaliseBase(process.env.BASE_PATH ?? '/dheys-cms');

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  integrations: [preact({ compat: false }), mdx()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: true,
    },
  },
  vite: {
    build: {
      /*
       * Sized for the admin island, which is the only large chunk this project produces
       * and is loaded on `/admin` alone. It carries Preact, Zod, the Markdown renderer and
       * the whole editorial library, and ~270 KB is what that honestly costs.
       *
       * This is not the article-page JavaScript budget. That budget is 30 KB, it is a
       * different number about a different bundle, and it is enforced where it can
       * actually be measured -- `tests/e2e/public-site.spec.ts` weighs every script an
       * article page loads and fails if the total exceeds it. A warning threshold here
       * would not catch a regression there, because an article page loads none of this.
       */
      chunkSizeWarningLimit: 320,
    },
  },
});
