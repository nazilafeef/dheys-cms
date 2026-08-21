import {
  toFailure,
  ProviderNotConfiguredError,
  type AgentProvider,
  type AgentJobResultLike,
  type ProviderContext,
} from './types';
import { agentJobResultSchema, type AgentJobRequest, type AgentJobResult } from '../job-contract';
import { envOr } from '../runner-env';

/**
 * The external-agent adapter, and bring-your-own.
 *
 * This is the seam for an operator who already has a content pipeline. The CMS dispatches
 * the job over a webhook and reads the result back; what happens in between is none of its
 * business. It deliberately does **not** reimplement a multi-agent article pipeline — the
 * CMS is the editorial and scheduling layer around one, not a second one.
 *
 * The contract is the whole interface. A pipeline that returns a valid `AgentJobResult`
 * works; one that does not is rejected with the same named-field errors a first-party
 * provider would get. There is no privileged path.
 *
 * Two shapes are supported:
 *   - synchronous  — the webhook returns the result in its response body.
 *   - deferred     — the webhook returns `{ status: "accepted", pollUrl }`, and this polls
 *                    until the pipeline finishes. Long generations must not be held open
 *                    inside a request that can time out.
 */

interface DeferredAcknowledgement {
  readonly status: 'accepted';
  readonly pollUrl: string;
}

function isDeferred(payload: unknown): payload is DeferredAcknowledgement {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return record['status'] === 'accepted' && typeof record['pollUrl'] === 'string';
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 10_000;

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __raw: text.slice(0, 500) };
  }
}

/**
 * Validate whatever the pipeline returned against the job contract.
 *
 * A pipeline that answers a different run than the one dispatched is rejected outright:
 * silently accepting it would attribute one job's output, cost and provenance to another.
 */
function validateResult(
  request: AgentJobRequest,
  payload: unknown,
  startedAt: Date,
  now: Date,
): AgentJobResult {
  const parsed = agentJobResultSchema.safeParse(payload);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return toFailure(
      request,
      `The external agent returned something that is not a job result — ${detail}. ` +
        `See docs/agent-job-contract.md for the shape it must return.`,
      startedAt,
      now,
    );
  }

  if (parsed.data.runId !== request.runId) {
    return toFailure(
      request,
      `The external agent answered run "${parsed.data.runId}" but was asked for "${request.runId}". ` +
        `Accepting it would file one job's output and cost against another.`,
      startedAt,
      now,
    );
  }

  return parsed.data;
}

async function pollUntilDone(
  request: AgentJobRequest,
  ctx: ProviderContext,
  pollUrl: string,
  headers: Record<string, string>,
  startedAt: Date,
): Promise<AgentJobResult> {
  const timeoutMs = Number(envOr(ctx.env, 'EXTERNAL_AGENT_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)));
  const intervalMs = Number(envOr(ctx.env, 'EXTERNAL_AGENT_POLL_MS', String(DEFAULT_INTERVAL_MS)));
  const sleep =
    ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await ctx.fetchImpl(pollUrl, {
      method: 'GET',
      headers,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (response.ok) {
      const payload = await readBody(response);
      // Still working: the pipeline re-acknowledges rather than returning a result.
      if (!isDeferred(payload)) {
        return validateResult(request, payload, startedAt, new Date());
      }
    }

    if (Date.now() >= deadline) {
      return toFailure(
        request,
        `The external agent did not finish within ${Math.round(timeoutMs / 1000)}s. The run may still be going; nothing has been written.`,
        startedAt,
        new Date(),
      );
    }

    await sleep(intervalMs);
  }
}

export const externalAgentProvider: AgentProvider = {
  id: 'external-agent',
  label: 'External agent (webhook)',
  requiredEnv: ['EXTERNAL_AGENT_URL'],

  isConfigured: (env) => Boolean(env['EXTERNAL_AGENT_URL']),

  async run(request, ctx): Promise<AgentJobResult> {
    const startedAt = ctx.now;
    const url = ctx.env['EXTERNAL_AGENT_URL'];
    if (!url) throw new ProviderNotConfiguredError('external-agent', this.requiredEnv);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = ctx.env['EXTERNAL_AGENT_TOKEN'];
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const response = await ctx.fetchImpl(url, {
        method: 'POST',
        headers,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        // The request is sent verbatim. A pipeline implementing the documented contract
        // needs nothing from this repository to work against it.
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const body = await readBody(response);
        return toFailure(
          request,
          `The external agent returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
          startedAt,
          new Date(),
        );
      }

      const payload = await readBody(response);

      if (isDeferred(payload)) {
        return pollUntilDone(request, ctx, payload.pollUrl, headers, startedAt);
      }

      return validateResult(request, payload, startedAt, new Date());
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

/**
 * Bring-your-own.
 *
 * Identical contract, different transport: the operator supplies a function rather than a
 * URL. Used by anyone embedding this CMS in a larger system, and by the tests, which is
 * why it exists as a first-class provider rather than as a test double.
 */
export function bringYourOwnProvider(
  id: string,
  handler: (request: AgentJobRequest, ctx: ProviderContext) => Promise<AgentJobResultLike>,
): AgentProvider {
  return {
    id,
    label: `Bring-your-own (${id})`,
    requiredEnv: [],
    isConfigured: () => true,
    async run(request, ctx) {
      const startedAt = ctx.now;
      try {
        const payload = await handler(request, ctx);
        return validateResult(request, payload, startedAt, new Date());
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
}
