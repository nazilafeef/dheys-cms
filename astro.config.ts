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
      chunkSizeWarningLimit: 200,
    },
  },
});
