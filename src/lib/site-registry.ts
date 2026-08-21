import { z } from 'zod';
import { LOCALE_CODES, type LocaleCode } from './i18n';
import { guardrailRuleSchema, DEFAULT_GUARDRAILS, type GuardrailRule } from './guardrails';
import { publishWindowSchema, approvalPolicySchema } from './schemas';

/**
 * The site registry.
 *
 * A site definition names a real repository, a real branch, sometimes a real deploy hook.
 * That is precisely the information Rule 2 forbids this repository from holding, so the
 * registry **never lives here**. It is loaded at runtime from one of three places the
 * operator chooses, and this repository ships only `sites.example.ts` with invented sites.
 *
 * All three sources return the same JSON, are validated by the same schema, and fail the
 * same way. Loading is done through an injected `RegistryFetcher` so tests exercise the
 * real parsing and the real error paths without any test ever touching api.github.com.
 */

const localeSchema = z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]);

/* ------------------------------------------------------------------ *
 * Deploy and content adapter configuration
 * ------------------------------------------------------------------ */

export const deployAdapterConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('github-pages'),
    /** Workflow file name in the site's own repository. */
    workflow: z.string().min(1).default('deploy.yml'),
    ref: z.string().min(1).default('main'),
  }),
  z.object({
    kind: z.literal('cloudflare-pages'),
    /** Deploy hook URL. Held in the registry, never in this repository. */
    deployHookEnv: z.string().min(1),
    projectNameEnv: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('netlify'),
    buildHookEnv: z.string().min(1),
    siteIdEnv: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('vercel'),
    deployHookEnv: z.string().min(1),
  }),
  z.object({
    kind: z.literal('webhook'),
    urlEnv: z.string().min(1),
    method: z.enum(['POST', 'PUT']).default('POST'),
    /** Names of environment variables to send as headers, e.g. an auth token. */
    headerEnv: z.record(z.string()).default({}),
  }),
]);

export type DeployAdapterConfig = z.infer<typeof deployAdapterConfigSchema>;

export const contentAdapterConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('collections'),
    /** Directory the target's content collections read from. */
    directory: z.string().min(1),
    extension: z.enum(['md', 'mdx']).default('md'),
  }),
  z.object({
    kind: z.literal('json'),
    /** File the target imports, e.g. `src/data/posts.json`. */
    outputPath: z.string().min(1),
    /** Include the rendered Markdown body in each record. */
    includeBody: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('js-module'),
    outputPath: z.string().min(1),
    exportName: z.string().min(1).default('posts'),
  }),
  z.object({
    kind: z.literal('generic'),
    directory: z.string().min(1),
    /** Command the target runs to transform the written Markdown. */
    transformCommand: z.string().min(1).optional(),
  }),
]);

export type ContentAdapterConfig = z.infer<typeof contentAdapterConfigSchema>;

/* ------------------------------------------------------------------ *
 * Site definition
 * ------------------------------------------------------------------ */

export const siteRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1).default('main'),
});

export const siteAgentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Provider ids this site may dispatch to, in preference order. */
  providers: z.array(z.string().min(1)).default([]),
  defaultModel: z.string().min(1).optional(),
  /** Named job chains, e.g. `{ "news": ["research", "write", "fact-check"] }`. */
  chains: z.record(z.array(z.string().min(1))).default({}),
  /**
   * Per-site monthly ceiling, in USD.
   *
   * **Optional on purpose, and not defaulted to 0.** With `.default(0)` there was no way to
   * tell "this site has no cap of its own" from "this site may spend nothing" — the same
   * collapse that let an empty `modelRates` masquerade as an absent one. `capsFrom` then
   * read `> 0` and dropped the site from the cap table, so a deliberate `0` meant
   * *unlimited* (up to the global cap) while the identical `0` on `globalMonthlyCapUsd`
   * meant *nothing may run*. One value, two opposite meanings, in one config object.
   *
   * Absent now means "no site-specific cap; the global cap governs". A present `0` means
   * this site may not spend.
   */
  monthlyCapUsd: z.number().nonnegative().optional(),
  /**
   * Per-model rate overrides. Required for any provider whose rates this CMS does not
   * ship -- an unpriced model is treated as costing its job ceiling, not as free.
   */
  modelRates: z
    .record(
      z.object({
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
      }),
    )
    .default({}),
});

export const sitePublishingSchema = z.object({
  /** IANA zone. Every schedule on this site is interpreted in it. */
  defaultTimezone: z.string().min(1).default('UTC'),
  defaultApprovalPolicy: approvalPolicySchema.default('human-required'),
  defaultWindow: publishWindowSchema.optional(),
});

export const siteRoleSchema = z.enum(['owner', 'editor', 'reviewer', 'contributor', 'viewer']);
export type SiteRole = z.infer<typeof siteRoleSchema>;

export const siteDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'site id must be lowercase, digits and hyphens'),
  name: z.string().min(1),
  repo: siteRepoSchema,
  /** Content root inside the site repository. */
  contentDir: z.string().min(1).default('src/content'),
  mediaDir: z.string().min(1).default('public/media'),
  locales: z.array(localeSchema).min(1),
  defaultLocale: localeSchema,
  theme: z.string().min(1).default('bare'),
  contentTypes: z.array(z.string().min(1)).default(['post', 'page']),
  publishing: sitePublishingSchema.default({
    defaultTimezone: 'UTC',
    defaultApprovalPolicy: 'human-required',
  }),
  agents: siteAgentConfigSchema.default({
    enabled: false,
    providers: [],
    chains: {},
    modelRates: {},
  }),
  deploy: deployAdapterConfigSchema,
  content: contentAdapterConfigSchema,
  guardrails: z.array(guardrailRuleSchema).default([...DEFAULT_GUARDRAILS]),
  /** GitHub login to role. Absent login means no access to this site. */
  permissions: z.record(siteRoleSchema).default({}),
  /** Analytics adapter id, resolved by the theme. Never a third-party script tag. */
  analytics: z.string().min(1).optional(),
});

export type SiteDefinition = z.infer<typeof siteDefinitionSchema>;

export const registrySchema = z.object({
  version: z.literal(1),
  /** Applies across every site; a per-site cap can only be stricter in effect. */
  /**
   * Global monthly ceiling, in USD. Defaults to `0`, which means **nothing may run** until
   * a budget is set deliberately — the safe direction for a default, and unchanged.
   */
  globalMonthlyCapUsd: z.number().nonnegative().default(0),
  defaultTimezone: z.string().min(1).default('UTC'),
  sites: z.array(siteDefinitionSchema),
});

export type Registry = z.infer<typeof registrySchema>;

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

/**
 * Where the registry lives. Three options, all documented in docs/site-registry.md:
 *
 *  - `gist`   — a private gist. Easiest to set up; readable by any token with `gist`.
 *  - `repo`   — a private companion repository. Best when the registry should be
 *               reviewed and versioned like code.
 *  - `inline` — the JSON itself, which is how a repository secret arrives inside an
 *               Actions runner (`${{ secrets.SITE_REGISTRY }}` into an env var).
 */
export const registrySourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('gist'),
    gistId: z.string().min(1),
    filename: z.string().min(1).default('dheys-sites.json'),
  }),
  z.object({
    kind: z.literal('repo'),
    owner: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1).default('dheys-sites.json'),
    ref: z.string().min(1).default('main'),
  }),
  z.object({
    kind: z.literal('inline'),
    json: z.string().min(1),
  }),
]);

export type RegistrySource = z.infer<typeof registrySourceSchema>;

/**
 * The only way this module reaches the network. Injected so no test ever needs a real
 * token or a real request, and so the same code runs in a browser (admin) and in a
 * runner (scheduler) without branching.
 */
export interface RegistryFetcher {
  (path: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export class RegistryError extends Error {
  readonly source: RegistrySource['kind'];

  constructor(source: RegistrySource['kind'], message: string) {
    super(message);
    this.name = 'RegistryError';
    this.source = source;
  }
}

/** Fetch the raw registry JSON from wherever the operator put it. */
export async function fetchRegistryJson(
  source: RegistrySource,
  fetcher: RegistryFetcher,
): Promise<string> {
  if (source.kind === 'inline') return source.json;

  const path =
    source.kind === 'gist'
      ? `/gists/${source.gistId}`
      : `/repos/${source.owner}/${source.name}/contents/${source.path}?ref=${source.ref}`;

  const response = await fetcher(path);
  if (!response.ok) {
    throw new RegistryError(
      source.kind,
      response.status === 404
        ? `Registry not found at ${path}. Check the id, the filename and that the token can read it.`
        : `Registry request failed with HTTP ${response.status} for ${path}.`,
    );
  }

  const raw = await response.text();

  if (source.kind === 'gist') {
    const payload = safeJson(raw, source.kind);
    const files = (payload as { files?: Record<string, { content?: string }> }).files;
    const file = files?.[source.filename];
    if (!file?.content) {
      const available = files ? Object.keys(files).join(', ') : '(none)';
      throw new RegistryError(
        source.kind,
        `Gist ${source.gistId} has no file named "${source.filename}". It contains: ${available}.`,
      );
    }
    return file.content;
  }

  const payload = safeJson(raw, source.kind) as { content?: string; encoding?: string };
  if (payload.encoding === 'base64' && typeof payload.content === 'string') {
    return decodeBase64(payload.content);
  }
  if (typeof payload.content === 'string') return payload.content;
  throw new RegistryError(source.kind, `Registry response carried no file content.`);
}

/** Fetch, parse and validate. Errors name the field, because the operator wrote it. */
export async function loadRegistry(
  source: RegistrySource,
  fetcher: RegistryFetcher,
): Promise<Registry> {
  const json = await fetchRegistryJson(source, fetcher);
  return parseRegistry(json, source.kind);
}

export function parseRegistry(
  json: string,
  sourceKind: RegistrySource['kind'] = 'inline',
): Registry {
  const payload = safeJson(json, sourceKind);
  const parsed = registrySchema.safeParse(payload);
  if (parsed.success) {
    assertUniqueIds(parsed.data, sourceKind);
    assertDefaultLocaleIsListed(parsed.data, sourceKind);
    return parsed.data;
  }
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n  ');
  throw new RegistryError(sourceKind, `Registry is not valid:\n  ${detail}`);
}

function assertUniqueIds(registry: Registry, sourceKind: RegistrySource['kind']): void {
  const seen = new Set<string>();
  for (const site of registry.sites) {
    if (seen.has(site.id)) {
      throw new RegistryError(
        sourceKind,
        `Two sites share the id "${site.id}". Site ids address content and must be unique.`,
      );
    }
    seen.add(site.id);
  }
}

function assertDefaultLocaleIsListed(registry: Registry, sourceKind: RegistrySource['kind']): void {
  for (const site of registry.sites) {
    if (!site.locales.includes(site.defaultLocale)) {
      throw new RegistryError(
        sourceKind,
        `Site "${site.id}" has defaultLocale "${site.defaultLocale}" but does not list it in locales (${site.locales.join(', ')}).`,
      );
    }
  }
}

function safeJson(raw: string, sourceKind: RegistrySource['kind']): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RegistryError(sourceKind, `Registry is not valid JSON: ${detail}`);
  }
}

function decodeBase64(value: string): string {
  const compact = value.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(compact, 'base64').toString('utf8');
}

/* ------------------------------------------------------------------ *
 * Reading the registry
 * ------------------------------------------------------------------ */

export function findSite(registry: Registry, siteId: string): SiteDefinition {
  const site = registry.sites.find((candidate) => candidate.id === siteId);
  if (!site) {
    const known = registry.sites.map((candidate) => candidate.id).join(', ') || '(none)';
    throw new Error(`No site with id "${siteId}" in the registry. Known sites: ${known}.`);
  }
  return site;
}

/** Guardrails in force for a site: its own if set, otherwise the shipped defaults. */
export function guardrailsFor(site: SiteDefinition): readonly GuardrailRule[] {
  return site.guardrails.length > 0 ? site.guardrails : DEFAULT_GUARDRAILS;
}

const ROLE_RANK: Readonly<Record<SiteRole, number>> = Object.freeze({
  viewer: 0,
  contributor: 1,
  reviewer: 2,
  editor: 3,
  owner: 4,
});

/** Whether `login` holds at least `required` on this site. */
export function hasRole(site: SiteDefinition, login: string, required: SiteRole): boolean {
  const held = site.permissions[login];
  if (!held) return false;
  return ROLE_RANK[held] >= ROLE_RANK[required];
}

/** Sites `login` may see at all, for the cross-site dashboard. */
export function sitesVisibleTo(registry: Registry, login: string): SiteDefinition[] {
  return registry.sites.filter((site) => site.permissions[login] !== undefined);
}

/** Cost caps assembled from the registry, in the shape `checkDispatch` expects. */
export function capsFrom(registry: Registry): {
  globalMonthlyUsd: number;
  perSiteMonthlyUsd: Record<string, number>;
} {
  const perSiteMonthlyUsd: Record<string, number> = {};
  for (const site of registry.sites) {
    // Presence, not truthiness. `> 0` silently turned a deliberate zero cap into no cap.
    const cap = site.agents.monthlyCapUsd;
    if (cap !== undefined) perSiteMonthlyUsd[site.id] = cap;
  }
  return { globalMonthlyUsd: registry.globalMonthlyCapUsd, perSiteMonthlyUsd };
}
