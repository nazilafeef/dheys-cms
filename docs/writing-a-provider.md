# Writing a provider

A provider takes a job request, produces a job result, and reports what it actually cost.
That is the whole interface.

It does **not** decide whether its output is acceptable. `intake()` does that, against the
same contract for every provider — so a bring-your-own implementation is held to exactly the
standard the built-in ones are. There is no privileged path.

## The interface

```ts
export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  readonly requiredEnv: readonly string[];
  isConfigured(env: ProviderEnv): boolean;
  run(request: AgentJobRequest, ctx: ProviderContext): Promise<AgentJobResult>;
}
```

```ts
export interface ProviderContext {
  readonly env: ProviderEnv;
  readonly fetchImpl: FetchLike; // injected — never reach for global fetch
  readonly now: Date;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
}
```

**Take the transport from the context.** That injection is what makes "no test may reach a
real AI provider" a property of the design rather than a promise: a provider _cannot_ make a
request except through what it was handed.

## A minimal one

```ts
import {
  buildSystemPrompt,
  buildUserPrompt,
  generatedItemSchema,
  GENERATED_ITEM_JSON_SCHEMA,
  toJobResult,
  toFailure,
  type AgentProvider,
} from '@lib/providers';
import { estimateCost } from '@lib/cost';

export const myProvider: AgentProvider = {
  id: 'my-provider',
  label: 'My Provider',
  requiredEnv: ['MY_PROVIDER_KEY'],

  isConfigured: (env) => Boolean(env['MY_PROVIDER_KEY']),

  async run(request, ctx) {
    const startedAt = ctx.now;
    try {
      const response = await ctx.fetchImpl('https://api.example.test/v1/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.env['MY_PROVIDER_KEY']}`,
        },
        body: JSON.stringify({
          system: buildSystemPrompt(request),
          user: buildUserPrompt(request),
          schema: GENERATED_ITEM_JSON_SCHEMA,
        }),
      });

      if (!response.ok) {
        return toFailure(request, `HTTP ${response.status}`, startedAt, new Date());
      }

      const payload = await response.json();
      const parsed = generatedItemSchema.safeParse(payload.item);
      if (!parsed.success) {
        return toFailure(request, 'output did not match the schema', startedAt, new Date());
      }

      const { costUsd } = estimateCost({
        model: 'my-model',
        tokensIn: payload.usage.in,
        tokensOut: payload.usage.out,
        fallbackUsd: request.maxCostUsd,
      });

      return toJobResult({
        request,
        generated: parsed.data,
        usage: {
          tokensIn: payload.usage.in,
          tokensOut: payload.usage.out,
          costUsd,
          model: 'my-model',
          provider: 'my-provider',
        },
        startedAt,
        completedAt: new Date(),
      });
    } catch (error) {
      return toFailure(request, String(error), startedAt, new Date());
    }
  },
};
```

Register it in `src/lib/providers/index.ts`.

## Rules

**Never throw out of `run`.** Return a failed result. A thrown error takes down the whole
workflow run, including the bookkeeping for jobs that succeeded.

**Never set `sourceType` yourself.** `toJobResult` marks provider output as `ai`. Letting a
model's output claim it was written by a human defeats the entire provenance chain.

**Report real usage.** Cost is priced from the token counts _you_ report against the rate
table. Reporting zero does not make a run free; it makes the cap wrong.

**Prices for a model this CMS does not know are the operator's to supply** through
`agents.modelRates` in the registry. An unpriced model estimates at the job ceiling —
expensive rather than invisible.

## Testing it

Hand it a scripted transport. No network, no key, no flakiness:

```ts
const impl = async (url: string, init?: RequestInit): Promise<Response> =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(fixture) }) as Response;

const result = await myProvider.run(request(), {
  env: { MY_PROVIDER_KEY: 'k' },
  fetchImpl: impl,
  now: new Date('2026-06-10T09:00:00.000Z'),
});

expect(intake(result).accepted).toBe(true);
```

## Not writing TypeScript?

Then do not write a provider — implement the
[job contract](./agent-job-contract.md) over HTTP and set `EXTERNAL_AGENT_URL`. The full
request is POSTed to you verbatim, and you return the documented shape. That path is
first-class and needs nothing from this repository.
