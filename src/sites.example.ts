import type { Registry } from './lib/site-registry';

/**
 * Example site registry.
 *
 * Every site here is invented. This file exists so a forker can see the shape of a real
 * registry, run the admin against something, and copy a working definition — and for no
 * other reason. **The real registry never lives in this repository.** It loads at runtime
 * from a private gist, a private companion repository, or a repository secret; all three
 * are documented in docs/site-registry.md.
 *
 * Copy this to your own storage, replace every value, and point `SITE_REGISTRY_SOURCE` at
 * it. Do not add a real site here, even temporarily — `pnpm check:clean-room` will fail
 * the build, which is the intended outcome.
 */
export const exampleRegistry: Registry = {
  version: 1,
  globalMonthlyCapUsd: 40,
  defaultTimezone: 'Indian/Maldives',

  sites: [
    {
      // A trilingual newsroom: the shape this CMS was designed around.
      id: 'example-news',
      name: 'Example News',
      repo: { owner: 'example-org', name: 'example-news', branch: 'main' },
      contentDir: 'src/content',
      mediaDir: 'public/media',
      locales: ['dv', 'en', 'ar'],
      defaultLocale: 'dv',
      theme: 'dheys',
      contentTypes: ['post', 'page', 'author', 'category', 'tag'],

      publishing: {
        defaultTimezone: 'Indian/Maldives',
        defaultApprovalPolicy: 'human-required',
        // Mornings only, weekdays. Randomised inside the window, seeded per item.
        defaultWindow: {
          from: '08:00',
          to: '11:00',
          timezone: 'Indian/Maldives',
          days: [0, 1, 2, 3, 4],
        },
      },

      agents: {
        enabled: true,
        providers: ['anthropic'],
        defaultModel: 'claude-opus-5',
        chains: {
          news: ['research', 'write', 'fact-check', 'seo-optimise'],
          translate: ['translate'],
        },
        monthlyCapUsd: 25,
        modelRates: {},
      },

      deploy: { kind: 'github-pages', workflow: 'deploy.yml', ref: 'main' },
      content: { kind: 'collections', directory: 'src/content/posts', extension: 'md' },

      guardrails: [
        { type: 'required-disclosure', kind: 'affiliate' },
        { type: 'required-disclosure', kind: 'ai' },
        { type: 'thaana-punctuation' },
        { type: 'human-review-required' },
        { type: 'minimum-words', count: 250 },
        { type: 'required-fields', fields: ['heroImageAlt', 'seo.description'] },
        { type: 'locale-completeness', locales: ['dv', 'en'] },
      ],

      permissions: {
        'example-editor': 'owner',
        'example-subeditor': 'editor',
        'example-reviewer': 'reviewer',
      },
    },

    {
      // A single-language journal on a different host, consuming JSON rather than Markdown.
      id: 'demo-journal',
      name: 'Demo Journal',
      repo: { owner: 'example-org', name: 'demo-journal', branch: 'main' },
      contentDir: 'content',
      mediaDir: 'static/media',
      locales: ['en'],
      defaultLocale: 'en',
      theme: 'bare',
      contentTypes: ['post', 'page', 'series'],

      publishing: {
        defaultTimezone: 'Europe/London',
        defaultApprovalPolicy: 'human-optional',
      },

      agents: {
        enabled: true,
        providers: ['anthropic', 'openai-compatible'],
        defaultModel: 'claude-sonnet-5',
        chains: { essay: ['research', 'write'] },
        monthlyCapUsd: 10,
        // A self-hosted model this CMS ships no rates for. Priced here, so the cap works.
        modelRates: {
          'local-mixtral': { inputPerMillion: 0, outputPerMillion: 0 },
        },
      },

      deploy: {
        kind: 'netlify',
        buildHookEnv: 'DEMO_JOURNAL_NETLIFY_BUILD_HOOK',
        siteIdEnv: 'DEMO_JOURNAL_NETLIFY_SITE_ID',
      },
      content: { kind: 'json', outputPath: 'src/data/posts.json', includeBody: true },

      guardrails: [
        { type: 'required-disclosure', kind: 'affiliate' },
        { type: 'required-disclosure', kind: 'ai' },
        { type: 'minimum-words', count: 600 },
      ],

      permissions: { 'example-editor': 'owner' },
    },

    {
      // Commerce-adjacent, which is where the affiliate rule earns its place.
      id: 'sample-shop',
      name: 'Sample Shop',
      repo: { owner: 'example-org', name: 'sample-shop', branch: 'production' },
      contentDir: 'content/guides',
      mediaDir: 'public/img',
      locales: ['en', 'ar'],
      defaultLocale: 'en',
      theme: 'bare',
      contentTypes: ['post'],

      publishing: {
        defaultTimezone: 'Asia/Dubai',
        defaultApprovalPolicy: 'auto',
      },

      agents: {
        enabled: false,
        providers: [],
        chains: {},
        monthlyCapUsd: 0,
        modelRates: {},
      },

      deploy: {
        kind: 'cloudflare-pages',
        deployHookEnv: 'SAMPLE_SHOP_CF_DEPLOY_HOOK',
        projectNameEnv: 'SAMPLE_SHOP_CF_PROJECT',
      },
      content: { kind: 'js-module', outputPath: 'src/data/guides.js', exportName: 'guides' },

      // `auto` skips the human step. It does not skip these.
      guardrails: [
        { type: 'required-disclosure', kind: 'affiliate' },
        { type: 'required-disclosure', kind: 'sponsored' },
        {
          type: 'banned-phrases',
          phrases: ['guaranteed returns', 'risk free'],
          caseSensitive: false,
        },
        { type: 'required-fields', fields: ['heroImageAlt'] },
      ],

      permissions: { 'example-editor': 'owner', 'example-merchandiser': 'contributor' },
    },
  ],
};

export default exampleRegistry;
