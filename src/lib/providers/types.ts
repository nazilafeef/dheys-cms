import { z } from 'zod';
import type { AgentJobRequest, AgentJobResult, JobType } from '../job-contract';
import { LOCALES, type LocaleCode } from '../i18n';

/**
 * The agent provider interface.
 *
 * One interface, every implementation opt-in. A provider's whole job is: take a job
 * request, produce an `AgentJobResult`, and report what it actually cost. It does not
 * decide whether the output is acceptable -- `intake()` does that, against the same
 * contract for every provider, so a bring-your-own implementation is held to exactly the
 * standard the built-in ones are.
 *
 * Providers only ever run inside a GitHub Actions runner. Nothing in this directory is
 * imported by the admin bundle, and the keys these read exist only in Actions secrets.
 */

export type ProviderEnv = Readonly<Record<string, string | undefined>>;

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface ProviderContext {
  readonly env: ProviderEnv;
  /** Injected so a test can exercise a provider without reaching the network. */
  readonly fetchImpl: FetchLike;
  readonly now: Date;
  /** Abort a long generation when the workflow is cancelled. */
  readonly signal?: AbortSignal;
  /** Injected so polling is instant in tests and real in a runner. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Whatever a third-party pipeline hands back, before it has been validated.
 *
 * Deliberately `unknown`: the point of the contract is that an external result is checked
 * rather than trusted, and typing it as `AgentJobResult` up front would assert exactly the
 * thing that still needs proving.
 */
export type AgentJobResultLike = unknown;

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  /**
   * Whether this runner has what the provider needs. Checked before dispatch so a missing
   * key is reported as configuration, not as a failed generation.
   */
  isConfigured(env: ProviderEnv): boolean;
  /** Names the environment variables this provider reads, for the setup docs and errors. */
  readonly requiredEnv: readonly string[];
  run(request: AgentJobRequest, ctx: ProviderContext): Promise<AgentJobResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string, required: readonly string[]) {
    super(
      `Provider "${providerId}" is not configured in this runner. It needs: ${required.join(', ')}. ` +
        `Set them as Actions secrets; they are never read from anywhere a browser can reach.`,
    );
    this.name = 'ProviderNotConfiguredError';
  }
}

/* ------------------------------------------------------------------ *
 * The shape a model is asked to return
 * ------------------------------------------------------------------ */

/**
 * What a generation job must produce.
 *
 * This mirrors the required half of the content schema deliberately. Handing the model a
 * schema and validating against the same one afterwards is what turns "please include a
 * category" from a hope into a constraint -- the two fields agents reliably forget,
 * `category` and `publishedDate`, are both required here.
 *
 * Kept separate from `postSchema` because a model should not be asked to invent editorial
 * state, transitions or provenance: those are the CMS's to write, not the model's.
 */
export const generatedItemSchema = z.object({
  title: z.string().describe('Headline. Sentence case. No trailing full stop.'),
  slug: z
    .string()
    .describe(
      'URL slug: lowercase Latin letters, digits and single hyphens only. For a non-Latin title, transliterate rather than translating.',
    ),
  category: z
    .string()
    .describe('Exactly one of the categories listed in the brief. Never invent a new one.'),
  publishedDate: z.string().describe('ISO 8601 instant, e.g. 2026-06-10T08:00:00.000Z'),
  excerpt: z.string().describe('One or two sentences. Plain text, no Markdown.'),
  locale: z.string().describe('BCP 47 code of the language the body is written in.'),
  author: z.string().describe('Byline as it should be displayed.'),
  tags: z.array(z.string()).describe('Zero or more lowercase tags.'),
  body: z.string().describe('The article itself, in Markdown. Headings start at level 2.'),
  seoDescription: z.string().describe('Meta description, at most 155 characters.'),
  heroImageAlt: z
    .string()
    .describe('Alt text describing the image this article should carry, for an editor to source.'),
});

export type GeneratedItem = z.infer<typeof generatedItemSchema>;

/**
 * The same shape as JSON Schema, for the providers' structured-output parameters.
 *
 * Hand-written rather than generated from the Zod schema at runtime, for two reasons: the
 * admin must never require `unsafe-eval`, and a schema compiler on the import path is how
 * that requirement creeps in; and the Anthropic SDK's Zod helper targets Zod 4 while this
 * project is on Zod 3, which Astro's content layer pins.
 *
 * `tests/unit/providers.test.ts` asserts the two definitions agree field for field, so
 * they cannot drift apart unnoticed.
 */
export const GENERATED_ITEM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'slug',
    'category',
    'publishedDate',
    'excerpt',
    'locale',
    'author',
    'tags',
    'body',
    'seoDescription',
    'heroImageAlt',
  ],
  properties: {
    title: { type: 'string', description: 'Headline. Sentence case. No trailing full stop.' },
    slug: {
      type: 'string',
      description:
        'Lowercase Latin letters, digits and single hyphens. Transliterate, never translate.',
    },
    category: { type: 'string', description: 'Exactly one of the categories given in the brief.' },
    publishedDate: { type: 'string', description: 'ISO 8601 instant.' },
    excerpt: { type: 'string', description: 'One or two sentences of plain text.' },
    locale: { type: 'string', description: 'BCP 47 code of the language the body is written in.' },
    author: { type: 'string', description: 'Byline as it should be displayed.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Zero or more lowercase tags.' },
    body: { type: 'string', description: 'The article, in Markdown. Headings start at level 2.' },
    seoDescription: { type: 'string', description: 'Meta description, at most 155 characters.' },
    heroImageAlt: {
      type: 'string',
      description: 'Alt text for the image this article should carry.',
    },
  },
} as const;

/* ------------------------------------------------------------------ *
 * Prompting
 * ------------------------------------------------------------------ */

const JOB_INSTRUCTIONS: Readonly<Record<JobType, string>> = Object.freeze({
  research:
    'Research the brief and return a structured summary with sources. Do not write the finished article; assemble the material for one.',
  write: 'Write the article the brief describes.',
  rewrite:
    'Rewrite the supplied article to address the notes in the brief. Preserve its facts, its structure where the notes do not touch it, and its voice.',
  translate:
    'Translate the supplied article into the target locale. Translate the prose, not the slug. Keep every fact, figure and proper noun exactly as it is.',
  'seo-optimise':
    'Improve the title, excerpt and meta description of the supplied article for search, without changing what it says or overstating it.',
  'fact-check':
    'Check every factual claim in the supplied article against the sources given. Return the article unchanged, and list any claim the sources do not support.',
  'image-alt':
    'Write alt text for the images the supplied article references. Describe what is in the image, not that it is an image.',
});

/**
 * The system prompt.
 *
 * Two things it insists on, because both are failure modes seen in the wild rather than
 * hypotheticals: every required field must be present (a model asked for "an article"
 * returns prose and quietly omits taxonomy and dates), and Dhivehi and Arabic must use
 * their own punctuation (a model writing Thaana will reach for a Latin comma by default,
 * which renders with the wrong directional class and visibly breaks the line).
 */
export function buildSystemPrompt(request: AgentJobRequest): string {
  const locale = LOCALES[request.locale as LocaleCode] ?? LOCALES.en;
  const target = request.targetLocale
    ? (LOCALES[request.targetLocale as LocaleCode] ?? locale)
    : locale;

  const lines = [
    'You are writing for a newsroom that publishes through Dheys CMS.',
    '',
    JOB_INSTRUCTIONS[request.jobType],
    '',
    'Every field in the output schema is required. An item missing any one of them is',
    'rejected before it reaches the site, so returning a good article with no category or',
    'no publishedDate is the same as returning nothing.',
    '',
    `Write in ${target.name} (${target.code}).`,
  ];

  if (target.dir === 'rtl') {
    lines.push(
      '',
      `${target.name} is written right to left. Use its own punctuation throughout:`,
      '  ،  (U+060C) for a comma, not ","',
      '  ؛  (U+061B) for a semicolon, not ";"',
      '  ؟  (U+061F) for a question mark, not "?"',
      'Latin punctuation inside right-to-left text renders with the wrong directional',
      'class and breaks the line visibly. This is checked, and it blocks publication.',
    );
  }

  if (request.allowedCategories.length > 0) {
    lines.push(
      '',
      `Choose the category from exactly this list: ${request.allowedCategories.join(', ')}.`,
      'Do not invent a category that is not on it.',
    );
  }

  lines.push(
    '',
    'The slug must be lowercase Latin letters, digits and single hyphens. For a title in',
    'Thaana or Arabic, transliterate it rather than translating it, so the URL stays',
    'stable if the headline is later reworded.',
  );

  return lines.join('\n');
}

export function buildUserPrompt(request: AgentJobRequest): string {
  const parts = [request.brief];

  if (request.sourceItem !== undefined) {
    parts.push('', 'The article to work from:', '', JSON.stringify(request.sourceItem, null, 2));
  }

  return parts.join('\n');
}

/** Job types that transform an existing item rather than creating one. */
export const TRANSFORM_JOBS: readonly JobType[] = [
  'rewrite',
  'translate',
  'seo-optimise',
  'fact-check',
  'image-alt',
];

/**
 * Fold a generated item into the result shape `intake()` validates.
 *
 * `sourceType` is set here rather than taken from the model: content produced by a
 * provider is AI-authored by definition, and letting the output claim otherwise is the
 * one thing the whole provenance chain exists to prevent.
 */
export function toJobResult(options: {
  request: AgentJobRequest;
  generated: GeneratedItem;
  usage: { tokensIn: number; tokensOut: number; costUsd: number; model: string; provider: string };
  startedAt: Date;
  completedAt: Date;
  sources?: ReadonlyArray<{ title: string; url: string }>;
}): AgentJobResult {
  const { request, generated, usage, startedAt, completedAt } = options;

  return {
    runId: request.runId,
    jobType: request.jobType,
    status: 'completed',
    item: {
      title: generated.title,
      slug: generated.slug,
      category: generated.category,
      publishedDate: generated.publishedDate,
      excerpt: generated.excerpt,
      locale: generated.locale,
      author: generated.author,
      sourceType: 'ai',
      tags: generated.tags,
      heroImageAlt: generated.heroImageAlt,
      seo: { description: generated.seoDescription, noindex: false },
      site: request.siteId,
    },
    body: generated.body,
    usage,
    startedAt,
    completedAt,
    promptVersion: request.promptVersion,
    sources: [...(options.sources ?? [])],
  };
}

/** A failed run, in the shape intake understands. */
export function toFailure(
  request: AgentJobRequest,
  reason: string,
  startedAt: Date,
  completedAt: Date,
): AgentJobResult {
  return {
    runId: request.runId,
    jobType: request.jobType,
    status: 'failed',
    startedAt,
    completedAt,
    promptVersion: request.promptVersion,
    sources: [],
    error: reason,
  };
}
