import { describe, it, expect } from 'vitest';
import {
  readRegistryLocation,
  writeRegistryLocation,
  clearRegistryLocation,
  parseRegistryLocation,
  toRegistrySource,
  REGISTRY_LOCATION_KEY,
  type StorageLike,
} from '@lib/admin/registry-location';

/**
 * Where the browser looks for the registry.
 *
 * The admin has no environment to read, so this is the only path by which a registry can
 * reach it on a public deployment. The shipped build had none: every documented location
 * was an Actions secret or a repository variable, both runner-only, so the UI could never
 * load a registry and every view sat behind a gate that could not open.
 */

/** An in-memory store, so nothing here depends on a browser or leaks between tests. */
function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store that throws, which is what a browser blocking site data actually does. */
const hostileStorage: StorageLike = {
  getItem() {
    throw new Error('site data is blocked');
  },
  setItem() {
    throw new Error('site data is blocked');
  },
  removeItem() {
    throw new Error('site data is blocked');
  },
};

describe('reading and writing the registry location', () => {
  it('round-trips a location', () => {
    const store = memoryStorage();
    const location = {
      kind: 'repo' as const,
      owner: 'example-org',
      name: 'registry',
      path: 'dheys-sites.json',
      ref: 'main',
    };
    expect(writeRegistryLocation(location, store)).toBe(true);
    expect(readRegistryLocation(store)).toEqual(location);
  });

  it('reads nothing when nothing was stored', () => {
    expect(readRegistryLocation(memoryStorage())).toBeNull();
  });

  it('treats corrupt stored data as "not configured" rather than throwing', () => {
    const store = memoryStorage({ [REGISTRY_LOCATION_KEY]: 'not json at all' });
    expect(readRegistryLocation(store)).toBeNull();
  });

  it('treats a stored value that no longer matches the schema as "not configured"', () => {
    const store = memoryStorage({
      [REGISTRY_LOCATION_KEY]: JSON.stringify({ kind: 'gist', gistId: 'x' }),
    });
    expect(readRegistryLocation(store)).toBeNull();
  });

  it('survives a browser that blocks site data, in both directions', () => {
    // Access throws rather than returning null, so every path has to be guarded.
    expect(readRegistryLocation(hostileStorage)).toBeNull();
    expect(
      writeRegistryLocation(
        { kind: 'repo', owner: 'a', name: 'b', path: 'c.json', ref: 'main' },
        hostileStorage,
      ),
    ).toBe(false);
    expect(() => clearRegistryLocation(hostileStorage)).not.toThrow();
  });

  it('clears', () => {
    const store = memoryStorage();
    writeRegistryLocation(
      { kind: 'repo', owner: 'a', name: 'b', path: 'c.json', ref: 'main' },
      store,
    );
    clearRegistryLocation(store);
    expect(readRegistryLocation(store)).toBeNull();
  });
});

describe('parsing what the operator typed', () => {
  it('fills the documented defaults when the optional fields are blank', () => {
    const parsed = parseRegistryLocation({
      owner: 'example-org',
      name: 'registry',
      path: '',
      ref: '',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.path).toBe('dheys-sites.json');
    expect(parsed.value.ref).toBe('main');
  });

  it('names the field that is wrong instead of failing generically', () => {
    const parsed = parseRegistryLocation({ owner: '', name: 'registry', path: '', ref: '' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('owner');
  });

  it('rejects an owner that is not a GitHub account name', () => {
    const parsed = parseRegistryLocation({
      owner: 'not a name/with slash',
      name: 'r',
      path: '',
      ref: '',
    });
    expect(parsed.ok).toBe(false);
  });

  it('trims, so a pasted value with stray whitespace still works', () => {
    const parsed = parseRegistryLocation({
      owner: '  example-org ',
      name: ' registry ',
      path: '',
      ref: '',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.owner).toBe('example-org');
    expect(parsed.value.name).toBe('registry');
  });
});

describe('handing the location to the loader', () => {
  it('produces the repo source shape loadRegistry expects', () => {
    expect(
      toRegistrySource({
        kind: 'repo',
        owner: 'example-org',
        name: 'registry',
        path: 'config/sites.json',
        ref: 'trunk',
      }),
    ).toEqual({
      kind: 'repo',
      owner: 'example-org',
      name: 'registry',
      path: 'config/sites.json',
      ref: 'trunk',
    });
  });
});
