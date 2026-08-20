import { registrySourceSchema, type RegistrySource, type RegistryFetcher } from './site-registry';
import type { GitHubClient } from './github';

/**
 * Reading a runner's environment.
 *
 * The registry never lives in this repository, so every runner has to be told where it is.
 * That configuration arrives as environment variables set from Actions secrets, and this
 * is the one place they are interpreted — a scheduler and an agent runner that disagreed
 * about which variable wins would load different registries and publish to different
 * places.
 */

/**
 * Where the registry lives, from the environment.
 *
 * Precedence is deliberate and documented in docs/site-registry.md:
 *
 *   1. `SITE_REGISTRY_JSON`  — the JSON itself, which is how a repository secret arrives.
 *   2. `SITE_REGISTRY_GIST`  — a private gist id.
 *   3. `SITE_REGISTRY_REPO`  — a private companion repository, as `owner/name[:path[@ref]]`.
 *
 * Inline wins because it is the most explicit: an operator who has pasted the registry
 * into a secret has said exactly what they want, and having a stale gist id elsewhere in
 * the environment quietly override that would be surprising.
 */
export function registrySourceFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RegistrySource {
  const inline = env['SITE_REGISTRY_JSON'];
  if (inline) return registrySourceSchema.parse({ kind: 'inline', json: inline });

  const gistId = env['SITE_REGISTRY_GIST'];
  if (gistId) {
    return registrySourceSchema.parse({
      kind: 'gist',
      gistId,
      filename: env['SITE_REGISTRY_FILENAME'] ?? 'dheys-sites.json',
    });
  }

  const repo = env['SITE_REGISTRY_REPO'];
  if (repo) {
    const [locator = '', ref = 'main'] = repo.split('@');
    const [ownerAndName = '', path = 'dheys-sites.json'] = locator.split(':');
    const [owner = '', name = ''] = ownerAndName.split('/');
    if (!owner || !name) {
      throw new Error(
        `SITE_REGISTRY_REPO must look like "owner/name", optionally "owner/name:path/to.json@ref". Got "${repo}".`,
      );
    }
    return registrySourceSchema.parse({ kind: 'repo', owner, name, path, ref });
  }

  throw new Error(
    'No site registry is configured. Set one of SITE_REGISTRY_JSON, SITE_REGISTRY_GIST or ' +
      'SITE_REGISTRY_REPO. See docs/site-registry.md — the registry deliberately does not ' +
      'live in this repository.',
  );
}

/**
 * A registry fetcher backed by an authenticated GitHub client.
 *
 * `loadRegistry` wants something response-shaped, and `GitHubClient.request` throws on a
 * non-2xx rather than returning one. Adapting here keeps the registry loader transport
 * -agnostic, which is what lets every registry test run without a network.
 */
export function githubRegistryFetcher(client: GitHubClient): RegistryFetcher {
  return async (path: string) => {
    try {
      const payload = await client.request<unknown>('GET', path);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      };
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status: unknown }).status)
          : 500;
      return {
        ok: false,
        status: Number.isFinite(status) ? status : 500,
        text: async () => (error instanceof Error ? error.message : String(error)),
      };
    }
  };
}
