import { describe, it, expect } from 'vitest';
import { GitHubClient, GitHubError, encodeBase64, decodeBase64 } from '@lib/github';

/**
 * The GitHub client — the admin's and the runners' only route to a network.
 *
 * The commit path is what these pin. Committing content is the single destructive thing
 * this CMS does, and the ways it goes wrong are specific: dropping the blob sha silently
 * overwrites a colleague's edit, and byte-oriented base64 mangles every Thaana article on
 * the way out.
 */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function stubFetch(
  responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Recorded[] = [];
  let index = 0;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
    });

    const scripted = responses[Math.min(index, responses.length - 1)] ?? {};
    index += 1;
    const status = scripted.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => scripted.headers?.[name.toLowerCase()] ?? null,
      },
      text: async () => (scripted.body === undefined ? '' : JSON.stringify(scripted.body)),
    } as unknown as Response;
  };

  return { impl, calls };
}

function clientWith(
  responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const { impl, calls } = stubFetch(responses);
  return { client: new GitHubClient({ token: 'test-token', fetchImpl: impl }), calls };
}

describe('construction', () => {
  it('refuses to build without a token', () => {
    expect(() => new GitHubClient({ token: '', fetchImpl: async () => new Response() })).toThrow(
      /token is required/,
    );
  });

  it('sends the token as a bearer, with the API version pinned', async () => {
    const { client, calls } = clientWith([{ body: { login: 'example-editor' } }]);
    await client.whoAmI();

    expect(calls[0]?.headers['Authorization']).toBe('Bearer test-token');
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    // GitHub rejects requests with no User-Agent.
    expect(calls[0]?.headers['User-Agent']).toBe('dheys-cms');
  });
});

describe('identity', () => {
  it('resolves a token to the account it belongs to', async () => {
    const { client, calls } = clientWith([{ body: { login: 'example-editor', name: null } }]);
    const user = await client.whoAmI();

    expect(user.login).toBe('example-editor');
    expect(calls[0]?.url).toBe('https://api.github.com/user');
  });

  it('explains a 401 in terms of the token, not the status code', async () => {
    const { client } = clientWith([{ status: 401, body: { message: 'Bad credentials' } }]);
    await expect(client.whoAmI()).rejects.toThrow(/token was rejected/);
  });

  it('explains a 403 in terms of what the token needs to grant', async () => {
    const { client } = clientWith([{ status: 403, body: { message: 'Resource not accessible' } }]);
    await expect(client.whoAmI()).rejects.toThrow(/Contents: read and write/);
  });

  it('explains a 404 on a private repository as a permissions problem', async () => {
    const { client } = clientWith([{ status: 404, body: { message: 'Not Found' } }]);
    await expect(client.getFile('example-org', 'example-news', 'a.md')).rejects.toThrow(
      /the token cannot see it/,
    );
  });

  it('carries GitHub’s own message through', async () => {
    const { client } = clientWith([{ status: 422, body: { message: 'Invalid request' } }]);
    await expect(client.whoAmI()).rejects.toThrow(/GitHub said: Invalid request/);
  });

  it('exposes the status for callers that branch on it', async () => {
    const { client } = clientWith([{ status: 404, body: { message: 'Not Found' } }]);
    await client.whoAmI().catch((error: unknown) => {
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).status).toBe(404);
    });
  });
});

describe('reading files', () => {
  it('decodes base64 content', async () => {
    const text = '---\ntitle: Hello\n---\n\nBody.\n';
    const { client } = clientWith([
      {
        body: {
          type: 'file',
          path: 'src/content/posts/en/a.md',
          sha: 'blob-sha-1',
          size: text.length,
          encoding: 'base64',
          content: Buffer.from(text, 'utf8').toString('base64'),
        },
      },
    ]);

    const file = await client.getFile('example-org', 'example-news', 'src/content/posts/en/a.md');
    expect(file.text).toBe(text);
    expect(file.sha).toBe('blob-sha-1');
  });

  it('round-trips Thaana through the contents API', async () => {
    const text = '---\ntitle: ބަނދަރުގެ ދިޔަވަރު\n---\n\nދިވެހި، ބަސް؟\n';
    const { client } = clientWith([
      {
        body: {
          type: 'file',
          path: 'a.md',
          sha: 's',
          size: 0,
          encoding: 'base64',
          content: Buffer.from(text, 'utf8').toString('base64'),
        },
      },
    ]);
    const file = await client.getFile('example-org', 'example-news', 'a.md');
    expect(file.text).toBe(text);
  });

  it('passes the ref through, so a non-default branch is readable', async () => {
    const { client, calls } = clientWith([
      { body: { type: 'file', path: 'a.md', sha: 's', size: 0, encoding: 'base64', content: '' } },
    ]);
    await client.getFile('example-org', 'sample-shop', 'a.md', 'production');
    expect(calls[0]?.url).toContain('?ref=production');
  });

  it('encodes each path segment without destroying the slashes', async () => {
    const { client, calls } = clientWith([
      { body: { type: 'file', path: 'a.md', sha: 's', size: 0, encoding: 'base64', content: '' } },
    ]);
    await client.getFile('example-org', 'example-news', 'src/content/posts/en/a file.md');

    expect(calls[0]?.url).toContain('/src/content/posts/en/a%20file.md');
    expect(calls[0]?.url).not.toContain('%2F');
  });

  it('normalises a single-file directory response into a list', async () => {
    const { client } = clientWith([
      { body: { type: 'file', name: 'a.md', path: 'posts/a.md', sha: 's', size: 1 } },
    ]);
    const listing = await client.listDirectory('example-org', 'example-news', 'posts');
    expect(listing).toHaveLength(1);
  });
});

describe('the commit path', () => {
  const text = '---\ntitle: Updated\n---\n\nNew body.\n';

  it('PUTs base64 content to the right path and branch', async () => {
    const { client, calls } = clientWith([
      { body: { content: { path: 'a.md', sha: 'new' }, commit: { sha: 'c', html_url: '' } } },
    ]);

    await client.putFile({
      owner: 'example-org',
      repo: 'example-news',
      path: 'src/content/posts/en/a.md',
      message: 'edit: a',
      content: text,
      branch: 'main',
      sha: 'blob-sha-1',
    });

    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.url).toBe(
      'https://api.github.com/repos/example-org/example-news/contents/src/content/posts/en/a.md',
    );

    const body = call?.body as Record<string, unknown>;
    expect(body['branch']).toBe('main');
    expect(body['message']).toBe('edit: a');
    expect(decodeBase64(String(body['content']))).toBe(text);
  });

  it('sends the blob sha it read, which is what stops a silent overwrite', async () => {
    const { client, calls } = clientWith([
      { body: { content: { path: 'a.md', sha: 'new' }, commit: { sha: 'c', html_url: '' } } },
    ]);

    await client.putFile({
      owner: 'example-org',
      repo: 'example-news',
      path: 'a.md',
      message: 'm',
      content: text,
      branch: 'main',
      sha: 'blob-sha-1',
    });

    expect((calls[0]?.body as Record<string, unknown>)['sha']).toBe('blob-sha-1');
  });

  it('omits the sha when creating a file that does not exist yet', async () => {
    const { client, calls } = clientWith([
      { body: { content: { path: 'a.md', sha: 'new' }, commit: { sha: 'c', html_url: '' } } },
    ]);

    await client.putFile({
      owner: 'example-org',
      repo: 'example-news',
      path: 'a.md',
      message: 'm',
      content: text,
      branch: 'main',
    });

    expect((calls[0]?.body as Record<string, unknown>)['sha']).toBeUndefined();
  });

  it('surfaces a 409 as a conflict to reload and reapply, not as a generic failure', async () => {
    const { client } = clientWith([{ status: 409, body: { message: 'is at a different sha' } }]);

    await expect(
      client.putFile({
        owner: 'example-org',
        repo: 'example-news',
        path: 'a.md',
        message: 'm',
        content: text,
        branch: 'main',
        sha: 'stale',
      }),
    ).rejects.toThrow(/changed since it was read — reload and reapply/);
  });

  it('commits Thaana without mangling it', async () => {
    const thaana = '---\ntitle: ބަނދަރު\n---\n\nދިވެހި، ބަސް؟\n';
    const { client, calls } = clientWith([
      { body: { content: { path: 'a.md', sha: 'new' }, commit: { sha: 'c', html_url: '' } } },
    ]);

    await client.putFile({
      owner: 'example-org',
      repo: 'example-news',
      path: 'a.md',
      message: 'm',
      content: thaana,
      branch: 'main',
    });

    const sent = decodeBase64(String((calls[0]?.body as Record<string, unknown>)['content']));
    expect(sent).toBe(thaana);
  });

  it('carries an explicit committer when one is given', async () => {
    const { client, calls } = clientWith([
      { body: { content: { path: 'a.md', sha: 'new' }, commit: { sha: 'c', html_url: '' } } },
    ]);

    await client.putFile({
      owner: 'example-org',
      repo: 'example-news',
      path: 'a.md',
      message: 'm',
      content: text,
      branch: 'main',
      committer: { name: 'Dheys scheduler', email: 'scheduler@example.com' },
    });

    expect((calls[0]?.body as Record<string, unknown>)['committer']).toEqual({
      name: 'Dheys scheduler',
      email: 'scheduler@example.com',
    });
  });
});

describe('workflows', () => {
  it('dispatches with a ref and inputs', async () => {
    const { client, calls } = clientWith([{ status: 204 }]);
    await client.dispatchWorkflow('example-org', 'example-news', 'deploy.yml', 'main', {
      site: 'example-news',
    });

    expect(calls[0]?.url).toContain('/actions/workflows/deploy.yml/dispatches');
    expect(calls[0]?.body).toEqual({ ref: 'main', inputs: { site: 'example-news' } });
  });

  it('treats 204 as success with no body', async () => {
    const { client } = clientWith([{ status: 204 }]);
    await expect(
      client.repositoryDispatch('nazilafeef', 'dheys-cms', 'dheys-scheduler-tick'),
    ).resolves.toBeUndefined();
  });

  it('lists runs for one workflow', async () => {
    const { client, calls } = clientWith([
      { body: { workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success' }] } },
    ]);
    const runs = await client.listWorkflowRuns('example-org', 'example-news', {
      workflow: 'deploy.yml',
      perPage: 5,
    });

    expect(runs).toHaveLength(1);
    expect(calls[0]?.url).toContain('/actions/workflows/deploy.yml/runs?per_page=5');
  });
});

describe('repository variables', () => {
  it('reads the kill switch', async () => {
    const { client } = clientWith([{ body: { name: 'DHEYS_PUBLISHING_HALTED', value: 'true' } }]);
    const value = await client.getVariable('nazilafeef', 'dheys-cms', 'DHEYS_PUBLISHING_HALTED');
    expect(value).toBe('true');
  });

  it('returns null for a variable that was never set, rather than throwing', async () => {
    const { client } = clientWith([{ status: 404, body: { message: 'Not Found' } }]);
    const value = await client.getVariable('nazilafeef', 'dheys-cms', 'NOT_SET');
    expect(value).toBeNull();
  });

  it('still throws on a real failure, so it is not mistaken for "unset"', async () => {
    const { client } = clientWith([{ status: 500, body: { message: 'boom' } }]);
    await expect(client.getVariable('nazilafeef', 'dheys-cms', 'X')).rejects.toThrow(GitHubError);
  });
});

describe('rate limit', () => {
  it('records what the last response reported', async () => {
    const { client } = clientWith([
      {
        body: { login: 'example-editor' },
        headers: {
          'x-ratelimit-remaining': '4321',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': '1780000000',
        },
      },
    ]);

    await client.whoAmI();
    expect(client.rateLimit.remaining).toBe(4321);
    expect(client.rateLimit.limit).toBe(5000);
    expect(client.rateLimit.resetAt?.toISOString()).toBe(new Date(1780000000 * 1000).toISOString());
  });
});

describe('base64', () => {
  it('round-trips ASCII', () => {
    expect(decodeBase64(encodeBase64('hello'))).toBe('hello');
  });

  it('round-trips Thaana, Arabic and emoji', () => {
    // `btoa` is byte-oriented and throws above U+00FF, so encoding a Dhivehi article with
    // it fails outright. UTF-8 first is not optional for this CMS.
    for (const value of ['ބަނދަރުގެ ދިޔަވަރު', 'مقياس المد', 'tide 🌊 gauge']) {
      expect(decodeBase64(encodeBase64(value))).toBe(value);
    }
  });

  it('tolerates the line-wrapped base64 the contents API returns', () => {
    const text = 'a'.repeat(200);
    const wrapped = encodeBase64(text).replace(/(.{60})/g, '$1\n');
    expect(decodeBase64(wrapped)).toBe(text);
  });
});
