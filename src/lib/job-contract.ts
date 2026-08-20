import { z } from 'zod';
import {
  postSchema,
  provenanceSchema,
  REQUIRED_ITEM_FIELDS,
  missingRequiredFields,
  toFieldErrors,
  type FieldError,
  type Post,
  type RequiredItemField,
} from './schemas';
import { LOCALE_CODES, type LocaleCode } from './i18n';

/**
 * The agent job contract.
 *
 * Anything that produces content for this CMS -- a direct provider call, an external
 * pipeline reached by webhook, or somebody's own script -- returns a job result in this
 * shape. The contract is enforced at intake, before a single byte reaches a site
 * repository, and it is strict on purpose.
 *
 * The two fields agents most reliably drop in practice are `category` and
 * `publishedDate`: a model asked for "an article about X" returns prose, a title and
 * usually an excerpt, and silently omits the taxonomy and the date because nothing in
 * the prompt made them feel like part of the writing. A site build three hours later
 * then fails on a collection schema, or worse, publishes an item dated the epoch. This
 * contract exists to catch that at the door and hand the operator a named field.
 *
 * The machine-readable version of this contract is published in
 * docs/agent-job-contract.md as JSON Schema, and tests/unit/job-contract.test.ts
 * asserts the two agree — a contract a third party cannot implement against without
 * reading the source is not a contract.
 */

export const JOB_TYPES = [
  'research',
  'write',
  'rewrite',
  'translate',
  'seo-optimise',
  'fact-check',
  'image-alt',
] as const;

export type JobType = (typeof JOB_TYPES)[number];
export const jobTypeSchema = z.enum(JOB_TYPES);

const localeSchema = z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]);

/* ------------------------------------------------------------------ *
 * Request
 * ------------------------------------------------------------------ */

export const agentJobRequestSchema = z.object({
  /** Stable id assigned by the CMS before dispatch, echoed back in the result. */
  runId: z.string().min(1),
  jobType: jobTypeSchema,
  siteId: z.string().min(1),
  locale: localeSchema,
  /** What to write. For `translate` and `rewrite`, the instruction that accompanies it. */
  brief: z.string().min(1),
  /** Input item for jobs that transform existing content. */
  sourceItem: z.unknown().optional(),
  /** For `translate`. */
  targetLocale: localeSchema.optional(),
  /** Version of the prompt template used, recorded in provenance. */
  promptVersion: z.string().min(1),
  /** Hard ceiling for this run, checked again by the provider before dispatch. */
  maxCostUsd: z.number().positive(),
  /** Taxonomy the site accepts, so the agent picks a real category rather than one it invents. */
  allowedCategories: z.array(z.string().min(1)).default([]),
  /** Commission that produced this job, if any. */
  commissionId: z.string().optional(),
});

export type AgentJobRequest = z.infer<typeof agentJobRequestSchema>;

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export const jobUsageSchema = z.object({
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  model: z.string().min(1),
  provider: z.string().min(1),
});

export type JobUsage = z.infer<typeof jobUsageSchema>;

/**
 * What a provider returns. `item` is deliberately `unknown` here: it is validated by
 * `intake` against the full content schema so that a malformed item produces field
 * errors rather than a parse failure with no detail.
 */
export const agentJobResultSchema = z.object({
  runId: z.string().min(1),
  jobType: jobTypeSchema,
  status: z.enum(['completed', 'failed']),
  item: z.unknown().optional(),
  /** Markdown body. Kept beside the frontmatter rather than inside it. */
  body: z.string().optional(),
  usage: jobUsageSchema.optional(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  promptVersion: z.string().min(1),
  sources: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.string().url(),
        accessedAt: z.coerce.date().optional(),
        unsupportedClaims: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  /** Present when `status` is `failed`. */
  error: z.string().optional(),
});

export type AgentJobResult = z.infer<typeof agentJobResultSchema>;

/* ------------------------------------------------------------------ *
 * Intake
 * ------------------------------------------------------------------ */

export interface AcceptedJob {
  readonly accepted: true;
  readonly runId: string;
  readonly item: Post;
  readonly body: string;
}

export interface RejectedJob {
  readonly accepted: false;
  readonly runId: string;
  /** Named fields, in the order the contract lists them. */
  readonly errors: readonly FieldError[];
  /** Fields that were absent entirely, which is the common agent failure. */
  readonly missingFields: readonly RequiredItemField[];
  /** One line suitable for the review queue's failed-job row. */
  readonly summary: string;
}

export type IntakeOutcome = AcceptedJob | RejectedJob;

function summarise(
  runId: string,
  errors: readonly FieldError[],
  missing: readonly string[],
): string {
  if (missing.length > 0) {
    return `Job ${runId} rejected at intake: missing ${missing.join(', ')}. Required fields are ${REQUIRED_ITEM_FIELDS.join(', ')}.`;
  }
  const first = errors[0];
  const rest = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
  return `Job ${runId} rejected at intake: ${first ? `${first.field} — ${first.message}` : 'invalid item'}${rest}.`;
}

/**
 * Validate a provider's job result and either accept an item for the review queue or
 * reject it with named fields. Nothing else in the codebase is permitted to write agent
 * output to a site repository without going through here.
 */
export function intake(raw: unknown): IntakeOutcome {
  const parsedResult = agentJobResultSchema.safeParse(raw);
  if (!parsedResult.success) {
    const errors = toFieldErrors(parsedResult.error);
    const runId = readRunId(raw);
    return {
      accepted: false,
      runId,
      errors,
      missingFields: [],
      summary: summarise(runId, errors, []),
    };
  }

  const result = parsedResult.data;

  if (result.status === 'failed') {
    const errors: FieldError[] = [
      { field: '(job)', message: result.error ?? 'the provider reported failure with no reason' },
    ];
    return {
      accepted: false,
      runId: result.runId,
      errors,
      missingFields: [],
      summary: `Job ${result.runId} failed at the provider: ${result.error ?? 'no reason given'}.`,
    };
  }

  if (result.item === undefined || result.item === null) {
    const errors: FieldError[] = [{ field: 'item', message: 'a completed job must carry an item' }];
    return {
      accepted: false,
      runId: result.runId,
      errors,
      missingFields: [...REQUIRED_ITEM_FIELDS],
      summary: summarise(result.runId, errors, REQUIRED_ITEM_FIELDS),
    };
  }

  // Report absence separately from invalidity: "category is missing" and "category is
  // not one of the site's categories" need different fixes.
  const missing = missingRequiredFields(result.item);

  const withProvenance = attachProvenance(result);
  const parsedItem = postSchema.safeParse(withProvenance);

  if (!parsedItem.success) {
    const errors = toFieldErrors(parsedItem.error);
    return {
      accepted: false,
      runId: result.runId,
      errors,
      missingFields: missing,
      summary: summarise(result.runId, errors, missing),
    };
  }

  return {
    accepted: true,
    runId: result.runId,
    item: parsedItem.data,
    body: result.body ?? '',
  };
}

/**
 * Build the provenance block from the run's own accounting and fold it into the item.
 * An agent is never trusted to report its own provenance: the run id, timings, token
 * counts and cost come from the dispatch record, not from the model's output.
 */
function attachProvenance(result: AgentJobResult): unknown {
  if (typeof result.item !== 'object' || result.item === null) return result.item;
  const item = { ...(result.item as Record<string, unknown>) };

  const sourceType = item['sourceType'];
  const isAiAuthored = sourceType === 'ai' || sourceType === 'ai-assisted';
  if (!isAiAuthored) return item;
  if (!result.usage) return item; // leaves provenance absent, which the schema rejects by name

  const provenance = provenanceSchema.safeParse({
    model: result.usage.model,
    provider: result.usage.provider,
    promptVersion: result.promptVersion,
    runId: result.runId,
    jobType: result.jobType,
    sources: result.sources,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    costUsd: result.usage.costUsd,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    ...(typeof item['reviewedBy'] === 'string' ? { reviewedBy: item['reviewedBy'] } : {}),
  });

  if (provenance.success) item['provenance'] = provenance.data;
  return item;
}

function readRunId(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const candidate = (raw as Record<string, unknown>)['runId'];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '(unknown run)';
}

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

/**
 * The attribution line rendered on AI-authored content. A theme may style or suppress
 * the placement, but the CMS always produces the line -- content written by a model is
 * never published under a bare human byline.
 */
export function attributionLine(
  item: Pick<Post, 'sourceType' | 'provenance' | 'author'>,
): string | undefined {
  if (item.sourceType !== 'ai' && item.sourceType !== 'ai-assisted') return undefined;
  if (!item.provenance) return undefined;
  const { model, reviewedBy } = item.provenance;
  return reviewedBy ? `Written by ${model}, reviewed by ${reviewedBy}` : `Written by ${model}`;
}

/** The fields a third-party implementation must supply, for docs and error messages. */
export const CONTRACT_REQUIRED_FIELDS: readonly RequiredItemField[] = REQUIRED_ITEM_FIELDS;
