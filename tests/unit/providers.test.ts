import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_IDS,
  findProvider,
  configuredProviders,
  resolveProvider,
  NoProviderError,
  bringYourOwnProvider,
  externalAgentProvider,
  openAiProvider,
  geminiProvider,
  openAiCompatibleProvider,
  generatedItemSchema,
  GENERATED_ITEM_JSON_SCHEMA,
  buildSystemPrompt,
} from '@lib/providers';
import { intake, agentJobRequestSchema, type AgentJobRequest } from '@lib/job-contract';
import type { ProviderContext } from '@lib/providers';

/**
 * Providers.
 *
 * Every transport here is injected. No test in this file — or anywhere in this suite —
 * can reach a real AI provider, and that is a property of the interface rather than a
 * convention: a provider cannot make a request except through the `fetchImpl` it is handed.
 */

const NOW = new Date('2026-06-10T09:00:00.000Z');

function request(overrides: Record<string, unknown> = {}): AgentJobRequest {
  return agentJobRequestSchema.parse({
    runId: 'run-test-1',
    jobType: 'write',
    siteId: 'example-news',
    locale: 'en',
    brief: 'Write about the tide gauge.',
    promptVersion: 'news-brief@3',
    maxCostUsd: 2,
    allowedCategories: ['environment', 'media'],
    ...overrides,
  });
}

const GOOD_ITEM = {
  title: 'The tide gauge at the old harbour',
  slug: 'the-tide-gauge-at-the-old-harbour',
  category: 'environment',
  publishedDate: '2026-06-10T08:00:00.000Z',
  excerpt: 'A century of readings, taken by hand.',
  locale: 'en',
  author: 'A. Editor',
  tags: ['tides'],
  body: '## What the record shows\n\nA slow, patient line.',
  seoDescription: 'A century of tide readings and what they show.',
  heroImageAlt: 'A brass tide gauge on a harbour wall.',
};

/** A fetch that answers from a script and records what it was asked. */
function scriptedFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, ...(init ? { init } : {}) });
    const scripted = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = scripted?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(scripted?.body ?? {}),
    } as Response;
  };

  return { impl, calls };
}

function ctx(
  fetchImpl: ProviderContext['fetchImpl'],
  env: Record<string, string> = {},
): ProviderContext {
  return { env, fetchImpl, now: NOW, sleep: async () => {} };
}

describe('the registry', () => {
  it('ships the providers the brief names', () => {
    expect(PROVIDER_IDS.sort()).toEqual([
      'anthropic',
      'external-agent',
      'gemini',
      'openai',
      'openai-compatible',
    ]);
  });

  it('reports every provider as unconfigured in an empty environment', () => {
    // A fresh install has no keys and must dispatch nothing.
    expect(configuredProviders({})).toEqual([]);
  });

  it('names the environment each provider needs', () => {
    for (const provider of PROVIDERS) {
      expect(provider.requiredEnv.length).toBeGreaterThan(0);
    }
  });

  it('reports a provider as configured once its key is present', () => {
    const configured = configuredProviders({ ANTHROPIC_API_KEY: 'x'.repeat(40) });
    expect(configured.map((provider) => provider.id)).toEqual(['anthropic']);
  });

  it('finds a provider by id', () => {
    expect(findProvider('gemini')?.label).toBe('Google Gemini');
    expect(findProvider('nope')).toBeUndefined();
  });
});

describe('resolving a provider', () => {
  it('takes the first configured provider in the site order', () => {
    const provider = resolveProvider(['anthropic', 'openai'], { OPENAI_API_KEY: 'k' });
    expect(provider.id).toBe('openai');
  });

  it('refuses rather than substituting when none is configured', () => {
    // Falling back to a different model would change what an article cost and who wrote
    // it -- both of which are recorded in provenance and shown to readers.
    expect(() => resolveProvider(['anthropic'], {})).toThrow(NoProviderError);
    expect(() => resolveProvider(['anthropic'], {})).toThrow(/needs ANTHROPIC_API_KEY/);
  });

  it('rejects a provider id that does not exist, listing the ones that do', () => {
    expect(() => resolveProvider(['gpt5-turbo'], {})).toThrow(/Unknown provider/);
    expect(() => resolveProvider(['gpt5-turbo'], {})).toThrow(/anthropic/);
  });

  it('says so plainly when a site lists no providers at all', () => {
    expect(() => resolveProvider([], {})).toThrow(/lists no providers/);
  });
});

describe('the generated-item schema', () => {
  it('requires exactly the same fields in both its Zod and JSON Schema forms', () => {
    // Two definitions exist because the Anthropic SDK's Zod helper targets Zod 4 and this
    // project is on Zod 3. They must not drift.
    const zodKeys = Object.keys(generatedItemSchema.shape).sort();
    const jsonKeys = Object.keys(GENERATED_ITEM_JSON_SCHEMA.properties).sort();
    expect(jsonKeys).toEqual(zodKeys);
    expect([...GENERATED_ITEM_JSON_SCHEMA.required].sort()).toEqual(zodKeys);
  });

  it('forbids extra properties, so a model cannot smuggle in fields', () => {
    expect(GENERATED_ITEM_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('asks the model for category and publishedDate explicitly', () => {
    expect(GENERATED_ITEM_JSON_SCHEMA.required).toContain('category');
    expect(GENERATED_ITEM_JSON_SCHEMA.required).toContain('publishedDate');
  });
});

describe('the system prompt', () => {
  it('tells the model every field is required and why', () => {
    const prompt = buildSystemPrompt(request());
    expect(prompt).toMatch(/Every field in the output schema is required/);
    expect(prompt).toMatch(/no category/);
    expect(prompt).toMatch(/no publishedDate/);
  });

  it('pins the category to the site taxonomy', () => {
    expect(buildSystemPrompt(request())).toMatch(/exactly this list: environment, media/);
  });

  it('spells out Thaana punctuation for a right-to-left locale', () => {
    const prompt = buildSystemPrompt(request({ locale: 'dv' }));
    expect(prompt).toContain('؟');
    expect(prompt).toContain('،');
    expect(prompt).toMatch(/right to left/);
    expect(prompt).toMatch(/blocks publication/);
  });

  it('says nothing about RTL punctuation for English', () => {
    expect(buildSystemPrompt(request({ locale: 'en' }))).not.toMatch(/right to left/);
  });

  it('describes a translate job as translating, not writing', () => {
    expect(buildSystemPrompt(request({ jobType: 'translate', targetLocale: 'ar' }))).toMatch(
      /Translate the supplied article/,
    );
  });
});

describe('OpenAI-shaped providers', () => {
  it('returns an accepted job result for good output', async () => {
    const { impl, calls } = scriptedFetch([
      {
        body: {
          choices: [{ message: { content: JSON.stringify(GOOD_ITEM) } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        },
      },
    ]);

    const result = await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'k' }));
    expect(result.status).toBe('completed');
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');

    const outcome = intake(result);
    expect(outcome.accepted).toBe(true);
  });

  it('marks the item as AI-authored regardless of what the model said', () => {
    // A provider's output is AI-authored by definition; letting it claim otherwise would
    // defeat the entire provenance chain.
    return openAiProvider
      .run(
        request(),
        ctx(
          scriptedFetch([
            {
              body: {
                choices: [
                  { message: { content: JSON.stringify({ ...GOOD_ITEM, sourceType: 'human' }) } },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 10 },
              },
            },
          ]).impl,
          { OPENAI_API_KEY: 'k' },
        ),
      )
      .then((result) => {
        const item = result.item as Record<string, unknown>;
        expect(item['sourceType']).toBe('ai');
      });
  });

  it('strips a Markdown fence some models add around JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(GOOD_ITEM) + '\n```';
    const { impl } = scriptedFetch([
      {
        body: {
          choices: [{ message: { content: fenced } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      },
    ]);
    const result = await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'k' }));
    expect(result.status).toBe('completed');
  });

  it('fails cleanly when the model returns prose instead of JSON', async () => {
    const { impl } = scriptedFetch([
      { body: { choices: [{ message: { content: 'Here is your article!' } }] } },
    ]);
    const result = await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'k' }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/not JSON/);
  });

  it('fails with a named field when the JSON is missing one', async () => {
    const { category: _dropped, ...withoutCategory } = GOOD_ITEM;
    const { impl } = scriptedFetch([
      { body: { choices: [{ message: { content: JSON.stringify(withoutCategory) } }] } },
    ]);
    const result = await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'k' }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/category/);
  });

  it('reports an HTTP error rather than throwing', async () => {
    const { impl } = scriptedFetch([{ status: 429, body: { error: 'rate limited' } }]);
    const result = await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'k' }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/HTTP 429/);
  });

  it('sends the key as a bearer token, never in the URL', async () => {
    const { impl, calls } = scriptedFetch([
      { body: { choices: [{ message: { content: JSON.stringify(GOOD_ITEM) } }] } },
    ]);
    await openAiProvider.run(request(), ctx(impl, { OPENAI_API_KEY: 'secret-key-value' }));
    expect(calls[0]?.url).not.toContain('secret-key-value');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-value');
  });

  it('points an OpenAI-compatible endpoint at its configured base URL', async () => {
    const { impl, calls } = scriptedFetch([
      { body: { choices: [{ message: { content: JSON.stringify(GOOD_ITEM) } }] } },
    ]);
    await openAiCompatibleProvider.run(
      request(),
      ctx(impl, {
        OPENAI_COMPATIBLE_BASE_URL: 'https://models.example.test/v1/',
        OPENAI_COMPATIBLE_MODEL: 'local-mixtral',
      }),
    );
    expect(calls[0]?.url).toBe('https://models.example.test/v1/chat/completions');
  });
});

describe('Gemini', () => {
  it('accepts good output and sends the key as a header', async () => {
    const { impl, calls } = scriptedFetch([
      {
        body: {
          candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD_ITEM) }] } }],
          usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400 },
        },
      },
    ]);

    const result = await geminiProvider.run(request(), ctx(impl, { GEMINI_API_KEY: 'gem-secret' }));
    expect(result.status).toBe('completed');

    // A key in a query string ends up in access logs and proxy caches.
    expect(calls[0]?.url).not.toContain('gem-secret');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gem-secret');
  });

  it('reports an unexpected response shape rather than crashing', async () => {
    const { impl } = scriptedFetch([{ body: { unexpected: true } }]);
    const result = await geminiProvider.run(request(), ctx(impl, { GEMINI_API_KEY: 'k' }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/unexpected shape/);
  });
});

describe('the external-agent adapter', () => {
  const completed = {
    runId: 'run-test-1',
    jobType: 'write',
    status: 'completed',
    item: { ...GOOD_ITEM, sourceType: 'ai' },
    body: GOOD_ITEM.body,
    usage: {
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.01,
      model: 'their-model',
      provider: 'theirs',
    },
    startedAt: '2026-06-10T09:00:00.000Z',
    completedAt: '2026-06-10T09:01:00.000Z',
    promptVersion: 'news-brief@3',
    sources: [],
  };

  it('accepts a synchronous result that satisfies the contract', async () => {
    const { impl } = scriptedFetch([{ body: completed }]);
    const result = await externalAgentProvider.run(
      request(),
      ctx(impl, { EXTERNAL_AGENT_URL: 'https://pipeline.example.test/jobs' }),
    );
    expect(result.status).toBe('completed');
    expect(intake(result).accepted).toBe(true);
  });

  it('polls when the pipeline defers, then accepts the result', async () => {
    const { impl, calls } = scriptedFetch([
      { body: { status: 'accepted', pollUrl: 'https://pipeline.example.test/jobs/1' } },
      { body: { status: 'accepted', pollUrl: 'https://pipeline.example.test/jobs/1' } },
      { body: completed },
    ]);

    const result = await externalAgentProvider.run(
      request(),
      ctx(impl, { EXTERNAL_AGENT_URL: 'https://pipeline.example.test/jobs' }),
    );

    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toBe('https://pipeline.example.test/jobs/1');
  });

  it('refuses a result that answers a different run', async () => {
    // Accepting it would file one job's output, cost and provenance against another.
    const { impl } = scriptedFetch([{ body: { ...completed, runId: 'someone-elses-run' } }]);
    const result = await externalAgentProvider.run(
      request(),
      ctx(impl, { EXTERNAL_AGENT_URL: 'https://pipeline.example.test/jobs' }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/answered run "someone-elses-run"/);
  });

  it('rejects a pipeline that returns something that is not a job result', async () => {
    const { impl } = scriptedFetch([{ body: { here: 'is your article' } }]);
    const result = await externalAgentProvider.run(
      request(),
      ctx(impl, { EXTERNAL_AGENT_URL: 'https://pipeline.example.test/jobs' }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/docs\/agent-job-contract\.md/);
  });

  it('sends the job request verbatim, so a pipeline needs nothing from this repo', async () => {
    const { impl, calls } = scriptedFetch([{ body: completed }]);
    await externalAgentProvider.run(
      request(),
      ctx(impl, { EXTERNAL_AGENT_URL: 'https://pipeline.example.test/jobs' }),
    );
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent['runId']).toBe('run-test-1');
    expect(sent['brief']).toBe('Write about the tide gauge.');
    expect(sent['allowedCategories']).toEqual(['environment', 'media']);
  });
});

describe('bring-your-own', () => {
  it('is held to exactly the same contract as a built-in provider', async () => {
    const good = bringYourOwnProvider('mine', async (req) => ({
      runId: req.runId,
      jobType: req.jobType,
      status: 'completed',
      item: { ...GOOD_ITEM, sourceType: 'ai' },
      body: GOOD_ITEM.body,
      usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, model: 'mine', provider: 'mine' },
      startedAt: NOW,
      completedAt: NOW,
      promptVersion: req.promptVersion,
      sources: [],
    }));

    const result = await good.run(
      request(),
      ctx(async () => new Response()),
    );
    expect(result.status).toBe('completed');
    expect(intake(result).accepted).toBe(true);
  });

  it('gets the same rejection a first-party provider would', async () => {
    const bad = bringYourOwnProvider('mine', async () => ({ nonsense: true }));
    const result = await bad.run(
      request(),
      ctx(async () => new Response()),
    );
    expect(result.status).toBe('failed');
  });

  it('turns a thrown error into a failed run rather than crashing the workflow', async () => {
    const throws = bringYourOwnProvider('mine', async () => {
      throw new Error('my pipeline fell over');
    });
    const result = await throws.run(
      request(),
      ctx(async () => new Response()),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toBe('my pipeline fell over');
  });
});
