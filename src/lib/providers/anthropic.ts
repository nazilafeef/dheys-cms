import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import {
  buildSystemPrompt,
  buildUserPrompt,
  generatedItemSchema,
  GENERATED_ITEM_JSON_SCHEMA,
  toFailure,
  toJobResult,
  ProviderNotConfiguredError,
  type AgentProvider,
  type ProviderContext,
  type ProviderEnv,
} from './types';
import { estimateCost } from '../cost';
import type { AgentJobRequest, AgentJobResult } from '../job-contract';

/**
 * Anthropic provider.
 *
 * Uses structured outputs rather than asking for JSON in prose and parsing what comes
 * back. `messages.parse` with a Zod output format constrains the response to the schema,
 * which is what makes "every required field is present" a property of the request instead
 * of something to hope for and then validate. The result still goes through `intake()` --
 * a constraint at generation time and a check at ingest time are not the same guarantee.
 *
 * Adaptive thinking is on and effort is `high`: an article that gets a fact wrong costs an
 * editor more than the tokens saved by thinking less about it.
 */

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_TOKENS = 16_000;

export const anthropicProvider: AgentProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  requiredEnv: ['ANTHROPIC_API_KEY'],

  isConfigured(env: ProviderEnv): boolean {
    return typeof env['ANTHROPIC_API_KEY'] === 'string' && env['ANTHROPIC_API_KEY'].length > 0;
  },

  async run(request: AgentJobRequest, ctx: ProviderContext): Promise<AgentJobResult> {
    const startedAt = ctx.now;
    const apiKey = ctx.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new ProviderNotConfiguredError('anthropic', this.requiredEnv);

    const model = ctx.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODEL;
    const client = new Anthropic({ apiKey, fetch: ctx.fetchImpl as typeof fetch });

    try {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(request),
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: jsonSchemaOutputFormat(GENERATED_ITEM_JSON_SCHEMA),
          },
          messages: [{ role: 'user', content: buildUserPrompt(request) }],
        },
        ctx.signal ? { signal: ctx.signal } : {},
      );

      if (!response.parsed_output) {
        return toFailure(
          request,
          `The model returned a response that did not match the required schema (stop reason: ${response.stop_reason ?? 'unknown'}).`,
          startedAt,
          ctx.now,
        );
      }

      // Validated again through the Zod schema even though the request constrained the
      // output. Constraining generation and checking ingest are different guarantees, and
      // this provider's result goes through the same door as an external pipeline's.
      const validated = generatedItemSchema.safeParse(response.parsed_output);
      if (!validated.success) {
        const detail = validated.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        return toFailure(
          request,
          `Structured output did not validate — ${detail}`,
          startedAt,
          ctx.now,
        );
      }
      const generated = validated.data;

      // Cost comes from the token counts the API reports, priced from the rate table --
      // never from anything the model said about itself.
      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      const { costUsd } = estimateCost({
        model,
        tokensIn,
        tokensOut,
        fallbackUsd: request.maxCostUsd,
      });

      return toJobResult({
        request,
        generated,
        usage: { tokensIn, tokensOut, costUsd, model, provider: 'anthropic' },
        startedAt,
        completedAt: new Date(),
      });
    } catch (error) {
      return toFailure(request, describeError(error), startedAt, new Date());
    }
  },
};

/**
 * Turn an SDK error into something an operator can act on.
 *
 * Checked most-specific first, using the SDK's typed classes rather than matching on
 * message text -- the messages change between versions and the classes do not.
 */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'ANTHROPIC_API_KEY was rejected. Check the secret in this repository’s Actions settings.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. The scheduler will retry this job on its next tick.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The Anthropic API rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API from this runner.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? '(no status)'}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
