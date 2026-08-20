import { anthropicProvider } from './anthropic';
import { openAiProvider, openAiCompatibleProvider, geminiProvider } from './http-providers';
import { externalAgentProvider, bringYourOwnProvider } from './webhook';
import type { AgentProvider, ProviderEnv } from './types';

/**
 * The provider registry.
 *
 * Every provider is opt-in and none is in the default path: a fresh install ships with no
 * keys, dispatches nothing, and works. `resolveProvider` refuses clearly rather than
 * falling back to whatever happens to be configured — silently substituting a different
 * model would change what an article cost and who wrote it, both of which are recorded in
 * provenance and shown to readers.
 */

export const PROVIDERS: readonly AgentProvider[] = Object.freeze([
  anthropicProvider,
  openAiProvider,
  geminiProvider,
  openAiCompatibleProvider,
  externalAgentProvider,
]);

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

export function findProvider(id: string): AgentProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Providers this runner could actually dispatch to right now. */
export function configuredProviders(env: ProviderEnv): AgentProvider[] {
  return PROVIDERS.filter((provider) => provider.isConfigured(env));
}

export class NoProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoProviderError';
  }
}

/**
 * Pick a provider for a site.
 *
 * Takes the site's preference order and returns the first that is configured. If a site
 * names providers but none of them is set up, that is an error naming what is missing --
 * not a quiet fallback to a provider the operator did not choose.
 */
export function resolveProvider(preferred: readonly string[], env: ProviderEnv): AgentProvider {
  if (preferred.length === 0) {
    throw new NoProviderError(
      'This site lists no providers. Add at least one to `agents.providers` in the registry, ' +
        `or leave \`agents.enabled\` false. Known providers: ${PROVIDER_IDS.join(', ')}.`,
    );
  }

  const unknown = preferred.filter((id) => findProvider(id) === undefined);
  if (unknown.length > 0) {
    throw new NoProviderError(
      `Unknown provider(s) in the registry: ${unknown.join(', ')}. Known providers: ${PROVIDER_IDS.join(', ')}.`,
    );
  }

  for (const id of preferred) {
    const provider = findProvider(id);
    if (provider?.isConfigured(env)) return provider;
  }

  const missing = preferred
    .map((id) => findProvider(id))
    .filter((provider): provider is AgentProvider => provider !== undefined)
    .map((provider) => `${provider.id} (needs ${provider.requiredEnv.join(', ')})`);

  throw new NoProviderError(
    `None of this site's providers is configured in this runner: ${missing.join('; ')}. ` +
      "Set the secrets in the repository's Actions settings.",
  );
}

export {
  anthropicProvider,
  openAiProvider,
  geminiProvider,
  openAiCompatibleProvider,
  externalAgentProvider,
  bringYourOwnProvider,
};

export type {
  AgentProvider,
  ProviderContext,
  ProviderEnv,
  GeneratedItem,
  AgentJobResultLike,
} from './types';

export {
  generatedItemSchema,
  buildSystemPrompt,
  buildUserPrompt,
  toJobResult,
  toFailure,
  ProviderNotConfiguredError,
} from './types';

export { GENERATED_ITEM_JSON_SCHEMA } from './http-providers';
