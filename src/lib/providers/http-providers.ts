import { z } from 'zod';
import {
  buildSystemPrompt,
  buildUserPrompt,
  generatedItemSchema,
  toFailure,
  toJobResult,
  ProviderNotConfiguredError,
  type AgentProvider,
  type GeneratedItem,
  type ProviderContext,
  GENERATED_ITEM_JSON_SCHEMA,
} from './types';
import { estimateCost } from '../cost';
import type { AgentJobRequest, AgentJobResult } from '../job-contract';

/**
 * The non-Anthropic direct providers: OpenAI, Gemini, and any OpenAI-compatible endpoint.
 *
 * These use `fetch` rather than each vendor's SDK. That is a deliberate trade: three more
 * SDKs would be three more dependency trees, three more release cadences and three more
 * things to audit, in exchange for wrapping two endpoints that have been stable for years.
 * The Anthropic provider does use its SDK, because structured outputs there are worth
 * having properly typed.
 *
 * All three are opt-in and none is in the default path.
 */

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

export { GENERATED_ITEM_JSON_SCHEMA };

/** Parse a model's JSON text into a generated item, or explain why it could not be. */
function parseGenerated(
  text: string,
): { ok: true; item: GeneratedItem } | { ok: false; reason: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(stripCodeFence(text));
  } catch {
    return {
      ok: false,
      reason: 'The model returned text that is not JSON. Structured output was requested.',
    };
  }

  const parsed = generatedItemSchema.safeParse(payload);
  if (parsed.success) return { ok: true, item: parsed.data };

  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, reason: `The model's JSON did not match the required shape — ${detail}` };
}

/**
 * Some models wrap JSON in a Markdown fence even when told not to. Stripping it is
 * cheaper than a retry and does not mask a real failure: anything that is not JSON after
 * the fence comes off is still reported as not JSON.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 500) };
  }
}

function priced(
  model: string,
  tokensIn: number,
  tokensOut: number,
  request: AgentJobRequest,
  provider: string,
) {
  const { costUsd } = estimateCost({
    model,
    tokensIn,
    tokensOut,
    fallbackUsd: request.maxCostUsd,
  });
  return { tokensIn, tokensOut, costUsd, model, provider };
}

/* ------------------------------------------------------------------ *
 * OpenAI and OpenAI-compatible
 * ------------------------------------------------------------------ */

const openAiResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

async function runOpenAiCompatible(
  request: AgentJobRequest,
  ctx: ProviderContext,
  options: { providerId: string; baseUrl: string; apiKey: string; model: string },
): Promise<AgentJobResult> {
  const startedAt = ctx.now;

  try {
    const response = await ctx.fetchImpl(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(request) },
          { role: 'user', content: buildUserPrompt(request) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'generated_item',
            strict: true,
            schema: GENERATED_ITEM_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await readJson(response);
      return toFailure(
        request,
        `${options.providerId} returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
        startedAt,
        new Date(),
      );
    }

    const payload = openAiResponseSchema.safeParse(await readJson(response));
    if (!payload.success) {
      return toFailure(
        request,
        `${options.providerId} returned a response in an unexpected shape.`,
        startedAt,
        new Date(),
      );
    }

    const content = payload.data.choices[0]?.message.content;
    if (!content) {
      return toFailure(
        request,
        `${options.providerId} returned an empty message.`,
        startedAt,
        new Date(),
      );
    }

    const generated = parseGenerated(content);
    if (!generated.ok) return toFailure(request, generated.reason, startedAt, new Date());

    return toJobResult({
      request,
      generated: generated.item,
      usage: priced(
        options.model,
        payload.data.usage?.prompt_tokens ?? 0,
        payload.data.usage?.completion_tokens ?? 0,
        request,
        options.providerId,
      ),
      startedAt,
      completedAt: new Date(),
    });
  } catch (error) {
    return toFailure(
      request,
      error instanceof Error ? error.message : String(error),
      startedAt,
      new Date(),
    );
  }
}

export const openAiProvider: AgentProvider = {
  id: 'openai',
  label: 'OpenAI',
  requiredEnv: ['OPENAI_API_KEY'],

  isConfigured: (env) => Boolean(env['OPENAI_API_KEY']),

  run(request, ctx) {
    const apiKey = ctx.env['OPENAI_API_KEY'];
    if (!apiKey) throw new ProviderNotConfiguredError('openai', this.requiredEnv);
    return runOpenAiCompatible(request, ctx, {
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
      model: ctx.env['OPENAI_MODEL'] ?? 'gpt-4.1',
    });
  },
};

/**
 * Any endpoint speaking the OpenAI chat-completions shape: a self-hosted model, a
 * gateway, or a provider that offers a compatibility layer. The base URL is configuration
 * rather than code, so adding one needs no change here.
 */
export const openAiCompatibleProvider: AgentProvider = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible endpoint',
  requiredEnv: [
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_MODEL',
  ],

  isConfigured: (env) =>
    Boolean(env['OPENAI_COMPATIBLE_BASE_URL']) && Boolean(env['OPENAI_COMPATIBLE_MODEL']),

  run(request, ctx) {
    const baseUrl = ctx.env['OPENAI_COMPATIBLE_BASE_URL'];
    const model = ctx.env['OPENAI_COMPATIBLE_MODEL'];
    if (!baseUrl || !model) {
      throw new ProviderNotConfiguredError('openai-compatible', this.requiredEnv);
    }
    return runOpenAiCompatible(request, ctx, {
      providerId: 'openai-compatible',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      // A self-hosted endpoint often needs no key at all; sending an empty bearer is
      // harmless and keeps one code path.
      apiKey: ctx.env['OPENAI_COMPATIBLE_API_KEY'] ?? '',
      model,
    });
  },
};

/* ------------------------------------------------------------------ *
 * Gemini
 * ------------------------------------------------------------------ */

const geminiResponseSchema = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string() })) }) }))
    .min(1),
  usageMetadata: z
    .object({ promptTokenCount: z.number(), candidatesTokenCount: z.number() })
    .optional(),
});

export const geminiProvider: AgentProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  requiredEnv: ['GEMINI_API_KEY'],

  isConfigured: (env) => Boolean(env['GEMINI_API_KEY']),

  async run(request, ctx) {
    const startedAt = ctx.now;
    const apiKey = ctx.env['GEMINI_API_KEY'];
    if (!apiKey) throw new ProviderNotConfiguredError('gemini', this.requiredEnv);

    const model = ctx.env['GEMINI_MODEL'] ?? 'gemini-2.5-pro';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    try {
      const response = await ctx.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than a query parameter: a key in a URL ends up in logs.
          'x-goog-api-key': apiKey,
        },
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(request) }] },
          contents: [{ role: 'user', parts: [{ text: buildUserPrompt(request) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GENERATED_ITEM_JSON_SCHEMA,
          },
        }),
      });

      if (!response.ok) {
        const body = await readJson(response);
        return toFailure(
          request,
          `Gemini returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
          startedAt,
          new Date(),
        );
      }

      const payload = geminiResponseSchema.safeParse(await readJson(response));
      if (!payload.success) {
        return toFailure(
          request,
          'Gemini returned a response in an unexpected shape.',
          startedAt,
          new Date(),
        );
      }

      const text =
        payload.data.candidates[0]?.content.parts.map((part) => part.text).join('') ?? '';
      const generated = parseGenerated(text);
      if (!generated.ok) return toFailure(request, generated.reason, startedAt, new Date());

      return toJobResult({
        request,
        generated: generated.item,
        usage: priced(
          model,
          payload.data.usageMetadata?.promptTokenCount ?? 0,
          payload.data.usageMetadata?.candidatesTokenCount ?? 0,
          request,
          'gemini',
        ),
        startedAt,
        completedAt: new Date(),
      });
    } catch (error) {
      return toFailure(
        request,
        error instanceof Error ? error.message : String(error),
        startedAt,
        new Date(),
      );
    }
  },
};
