import { describe, it, expect } from 'vitest';
import {
  loadRegistry,
  parseRegistry,
  findSite,
  hasRole,
  sitesVisibleTo,
  capsFrom,
  guardrailsFor,
  RegistryError,
  type RegistryFetcher,
} from '@lib/site-registry';
import { checkDispatch } from '@lib/cost';
import { exampleRegistry } from '../../src/sites.example';

/**
 * Every loader is exercised through an injected fetcher. No test here reaches
 * api.github.com, and the injection is what makes that a property of the design rather
 * than a promise.
 */

const REGISTRY_JSON = JSON.stringify(exampleRegistry);

function fetcherReturning(body: string, status = 200): RegistryFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (path: string) => {
    calls.push(path);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  }) as RegistryFetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}

describe('the example registry itself', () => {
  it('validates against the schema it documents', () => {
    expect(() => parseRegistry(REGISTRY_JSON)).not.toThrow();
  });

  it('ships only invented sites', () => {
    for (const site of exampleRegistry.sites) {
      expect(['example-news', 'demo-journal', 'sample-shop']).toContain(site.id);
      expect(site.repo.owner).toBe('example-org');
    }
  });
});

describe('loading — inline (a repository secret inside a runner)', () => {
  it('parses JSON handed straight in', async () => {
    const registry = await loadRegistry(
      { kind: 'inline', json: REGISTRY_JSON },
      fetcherReturning(''),
    );
    expect(registry.sites).toHaveLength(3);
  });

  it('makes no request at all', async () => {
    const fetcher = fetcherReturning('');
    await loadRegistry({ kind: 'inline', json: REGISTRY_JSON }, fetcher);
    expect(fetcher.calls).toEqual([]);
  });
});

describe('loading — private gist', () => {
  it('pulls the named file out of the gist payload', async () => {
    const fetcher = fetcherReturning(
      JSON.stringify({ files: { 'dheys-sites.json': { content: REGISTRY_JSON } } }),
    );
    const registry = await loadRegistry(
      { kind: 'gist', gistId: 'abc123', filename: 'dheys-sites.json' },
      fetcher,
    );
    expect(registry.sites).toHaveLength(3);
    expect(fetcher.calls).toEqual(['/gists/abc123']);
  });

  it('says which files the gist actually holds when the name is wrong', async () => {
    const fetcher = fetcherReturning(
      JSON.stringify({ files: { 'other.json': { content: '{}' } } }),
    );
    await expect(
      loadRegistry({ kind: 'gist', gistId: 'abc123', filename: 'dheys-sites.json' }, fetcher),
    ).rejects.toThrow(/It contains: other\.json/);
  });

  it('explains a 404 in terms of what to check', async () => {
    const fetcher = fetcherReturning('', 404);
    await expect(
      loadRegistry({ kind: 'gist', gistId: 'nope', filename: 'dheys-sites.json' }, fetcher),
    ).rejects.toThrow(/Check the id, the filename and that the token can read it/);
  });
});

describe('loading — private companion repository', () => {
  it('decodes base64 contents, which is what the contents API returns', async () => {
    const encoded = Buffer.from(REGISTRY_JSON, 'utf8').toString('base64');
    const fetcher = fetcherReturning(JSON.stringify({ content: encoded, encoding: 'base64' }));
    const registry = await loadRegistry(
      { kind: 'repo', owner: 'example-org', name: 'ops', path: 'dheys-sites.json', ref: 'main' },
      fetcher,
    );
    expect(registry.sites).toHaveLength(3);
    expect(fetcher.calls[0]).toBe('/repos/example-org/ops/contents/dheys-sites.json?ref=main');
  });

  it('survives the line-wrapped base64 GitHub actually sends', async () => {
    const encoded = Buffer.from(REGISTRY_JSON, 'utf8')
      .toString('base64')
      .replace(/(.{60})/g, '$1\n');
    const fetcher = fetcherReturning(JSON.stringify({ content: encoded, encoding: 'base64' }));
    const registry = await loadRegistry(
      { kind: 'repo', owner: 'example-org', name: 'ops', path: 'x.json', ref: 'main' },
      fetcher,
    );
    expect(registry.sites).toHaveLength(3);
  });
});

describe('validation errors name the field the operator wrote', () => {
  it('rejects a missing version', () => {
    expect(() => parseRegistry(JSON.stringify({ sites: [] }))).toThrow(/version/);
  });

  it('rejects an uppercase site id', () => {
    const broken = { ...exampleRegistry, sites: [{ ...exampleRegistry.sites[0], id: 'Example' }] };
    expect(() => parseRegistry(JSON.stringify(broken))).toThrow(/lowercase, digits and hyphens/);
  });

  it('rejects two sites sharing an id', () => {
    const first = exampleRegistry.sites[0];
    const broken = { ...exampleRegistry, sites: [first, first] };
    expect(() => parseRegistry(JSON.stringify(broken))).toThrow(/share the id/);
  });

  it('rejects a defaultLocale the site does not list', () => {
    const broken = {
      ...exampleRegistry,
      sites: [{ ...exampleRegistry.sites[0], locales: ['en'], defaultLocale: 'dv' }],
    };
    expect(() => parseRegistry(JSON.stringify(broken))).toThrow(/does not list it in locales/);
  });

  it('rejects an unknown deploy adapter', () => {
    const broken = {
      ...exampleRegistry,
      sites: [{ ...exampleRegistry.sites[0], deploy: { kind: 'ftp' } }],
    };
    expect(() => parseRegistry(JSON.stringify(broken))).toThrow(RegistryError);
  });

  it('reports malformed JSON as malformed JSON', () => {
    expect(() => parseRegistry('{ not json')).toThrow(/not valid JSON/);
  });
});

describe('reading the registry', () => {
  const registry = parseRegistry(REGISTRY_JSON);

  it('finds a site by id', () => {
    expect(findSite(registry, 'demo-journal').name).toBe('Demo Journal');
  });

  it('lists the known ids when asked for one that does not exist', () => {
    expect(() => findSite(registry, 'nope')).toThrow(/example-news, demo-journal, sample-shop/);
  });

  it('ranks roles so a reviewer does not pass an editor check', () => {
    const news = findSite(registry, 'example-news');
    expect(hasRole(news, 'example-editor', 'owner')).toBe(true);
    expect(hasRole(news, 'example-subeditor', 'reviewer')).toBe(true);
    expect(hasRole(news, 'example-reviewer', 'editor')).toBe(false);
    expect(hasRole(news, 'nobody', 'viewer')).toBe(false);
  });

  it('shows a user only the sites they hold a role on', () => {
    expect(sitesVisibleTo(registry, 'example-merchandiser').map((site) => site.id)).toEqual([
      'sample-shop',
    ]);
    expect(sitesVisibleTo(registry, 'example-editor')).toHaveLength(3);
  });

  it('assembles cost caps in the shape the dispatch check expects', () => {
    const caps = capsFrom(registry);
    expect(caps.globalMonthlyUsd).toBe(40);
    expect(caps.perSiteMonthlyUsd).toEqual({
      'example-news': 25,
      'demo-journal': 10,
      'sample-shop': 0,
    });
  });

  it('carries a zero cap through as zero, rather than dropping it', () => {
    /*
     * `sample-shop` sets `monthlyCapUsd: 0` and has agents disabled: it may not spend.
     * `capsFrom` used to test `> 0` and drop the site from the table entirely, which made a
     * deliberate zero mean *unlimited* — the global cap became the only limit. The identical
     * `0` on `globalMonthlyCapUsd` meant the opposite, blocking everything. One value, two
     * contradictory meanings. See DECISIONS 73.
     */
    const caps = capsFrom(registry);
    expect(caps.perSiteMonthlyUsd['sample-shop']).toBe(0);

    const verdict = checkDispatch({
      caps,
      ledger: [],
      siteId: 'sample-shop',
      estimatedCostUsd: 0.01,
      rateKnown: true,
      now: new Date('2026-06-10T09:00:00.000Z'),
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.scope).toBe('site');
  });

  it('omits a site that declares no cap of its own, so the global cap governs', () => {
    const site = findSite(registry, 'example-news');
    const withoutCap = {
      ...site,
      agents: { ...site.agents, monthlyCapUsd: undefined },
    };
    const caps = capsFrom({ ...registry, sites: [withoutCap] });
    expect(caps.perSiteMonthlyUsd['example-news']).toBeUndefined();
  });

  it('falls back to the shipped guardrails when a site declares none', () => {
    const site = { ...findSite(registry, 'demo-journal'), guardrails: [] };
    expect(guardrailsFor(site).some((rule) => rule.type === 'required-disclosure')).toBe(true);
  });

  it('keeps the affiliate rule on a site that publishes automatically', () => {
    const shop = findSite(registry, 'sample-shop');
    expect(shop.publishing.defaultApprovalPolicy).toBe('auto');
    expect(
      guardrailsFor(shop).some(
        (rule) => rule.type === 'required-disclosure' && rule.kind === 'affiliate',
      ),
    ).toBe(true);
  });
});
