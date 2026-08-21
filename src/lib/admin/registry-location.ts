import { z } from 'zod';
import type { RegistrySource } from '@lib/site-registry';

/**
 * Where *this browser* should look for the site registry.
 *
 * The three locations in `docs/site-registry.md` are all read from the environment —
 * `SITE_REGISTRY_JSON` from an Actions secret, `SITE_REGISTRY_GIST` and
 * `SITE_REGISTRY_REPO` from repository variables. A runner has an environment. A static
 * page served from GitHub Pages does not, so as shipped the admin could never load a
 * registry at all: the scheduler worked and the UI was permanently empty.
 *
 * The build-time escape hatch that existed, `PUBLIC_SITE_REGISTRY`, is not a fix and is
 * not offered here. Anything prefixed `PUBLIC_` is inlined into the JavaScript bundle, and
 * that bundle is served from a public origin — it would publish the operator's repository
 * names, branches and deploy targets to anyone who opened devtools. The registry is a map
 * of someone's infrastructure; it does not belong in a public asset.
 *
 * So the location is stored per-browser and the registry is fetched at runtime with the
 * operator's own token. The *location* is stored, never the registry contents and never
 * the token: `localStorage` survives a reload, which is the point, and a token that
 * survived a reload would outlive the session it was scoped to.
 */

export const REGISTRY_LOCATION_KEY = 'dheys-registry-location';

/**
 * A private companion repository, which is the option that actually works in a browser.
 *
 * Gists are deliberately absent. A fine-grained token — the kind this admin asks for, and
 * the kind that can be scoped to a single repository — cannot be granted gist access at
 * all: gist permissions exist only on classic tokens. Offering a gist field here would
 * invite an operator to configure something that returns 404 for reasons the UI could not
 * explain. The runner can still use a gist, because a runner can hold a classic token.
 */
export const registryLocationSchema = z.object({
  kind: z.literal('repo'),
  owner: z
    .string()
    .trim()
    .min(1, 'owner is required')
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'owner must be a GitHub account name'),
  name: z
    .string()
    .trim()
    .min(1, 'repository is required')
    .regex(/^[A-Za-z0-9._-]+$/, 'repository must be a GitHub repository name'),
  path: z.string().trim().min(1).default('dheys-sites.json'),
  ref: z.string().trim().min(1).default('main'),
});

export type RegistryLocation = z.infer<typeof registryLocationSchema>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage as unknown as StorageLike;
  } catch {
    // A browser configured to block site data throws on access rather than returning null.
    return undefined;
  }
}

/** Read the stored location. Anything unreadable or invalid reads as "not configured". */
export function readRegistryLocation(
  storage: StorageLike | undefined = defaultStorage(),
): RegistryLocation | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(REGISTRY_LOCATION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = registryLocationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Persist the location. Returns false when storage is unavailable rather than throwing. */
export function writeRegistryLocation(
  location: RegistryLocation,
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(REGISTRY_LOCATION_KEY, JSON.stringify(location));
    return true;
  } catch {
    return false;
  }
}

export function clearRegistryLocation(storage: StorageLike | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(REGISTRY_LOCATION_KEY);
  } catch {
    /* nothing to clear if the store cannot be reached */
  }
}

/** The shape `loadRegistry` expects. */
export function toRegistrySource(location: RegistryLocation): RegistrySource {
  return {
    kind: 'repo',
    owner: location.owner,
    name: location.name,
    path: location.path,
    ref: location.ref,
  };
}

/**
 * Parse a form into a location, returning field errors rather than throwing.
 *
 * The blanks are filled here rather than in the form so that an operator who types only an
 * owner and a repository gets the documented defaults, which is the common case.
 */
export function parseRegistryLocation(input: {
  owner: string;
  name: string;
  path: string;
  ref: string;
}): { ok: true; value: RegistryLocation } | { ok: false; error: string } {
  const parsed = registryLocationSchema.safeParse({
    kind: 'repo',
    owner: input.owner,
    name: input.name,
    path: input.path.trim() === '' ? undefined : input.path,
    ref: input.ref.trim() === '' ? undefined : input.ref,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const detail = parsed.error.issues
    .map(
      (issue) => `${issue.path.filter((p) => p !== 'kind').join('.') || 'value'}: ${issue.message}`,
    )
    .join('; ');
  return { ok: false, error: detail };
}
