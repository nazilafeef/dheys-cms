import { z } from 'zod';
import { LOCALE_CODES, type LocaleCode } from './i18n';
import { isValidSlug } from './slug';

/**
 * Content schemas.
 *
 * Every item that reaches a site repository is validated here first, whoever wrote it.
 * Two rules in this file are load-bearing rather than decorative:
 *
 *  1. The eight fields the agent job contract calls non-negotiable are `.min(1)` or
 *     equivalent, so an agent that omits `category` or `publishedDate` -- the two most
 *     common real-world omissions -- fails at intake with a named field, not at the
 *     target site's build three hours later.
 *
 *  2. Affiliate disclosure is enforced *in the schema*. Putting it in the UI means it
 *     holds only for items a human typed; putting it here means it holds for agent
 *     output, imports and direct commits too.
 *
 * Validation errors are reported by field name because the review queue shows them to
 * an editor, who has to be able to fix the thing being complained about.
 */

/* ------------------------------------------------------------------ *
 * Editorial state
 * ------------------------------------------------------------------ */

export const EDITORIAL_STATES = [
  'idea',
  'commissioned',
  'researching',
  'drafting',
  'draft',
  'in-review',
  'changes-requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
] as const;

export type EditorialState = (typeof EDITORIAL_STATES)[number];

export const editorialStateSchema = z.enum(EDITORIAL_STATES);

/** Who or what performed a transition. Never optional: the audit trail depends on it. */
export const actorSchema = z.object({
  kind: z.enum(['human', 'agent', 'system']),
  /** GitHub login for a human, agent run id for an agent, workflow name for system. */
  id: z.string().min(1, 'actor.id is required — an unattributed transition is not auditable'),
});

export const transitionSchema = z.object({
  from: editorialStateSchema.nullable(),
  to: editorialStateSchema,
  at: z.coerce.date(),
  actor: actorSchema,
  note: z.string().optional(),
});

export type Transition = z.infer<typeof transitionSchema>;
export type Actor = z.infer<typeof actorSchema>;

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

export const sourceTypeSchema = z.enum(['human', 'ai', 'ai-assisted', 'imported']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const provenanceSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url('a provenance source must carry a resolvable URL'),
  accessedAt: z.coerce.date().optional(),
  /** Set by a fact-check job when a claim could not be supported by this source. */
  unsupportedClaims: z.array(z.string()).optional(),
});

export const provenanceSchema = z.object({
  model: z.string().min(1, 'provenance.model is required for AI-authored content'),
  provider: z.string().min(1),
  promptVersion: z.string().min(1),
  runId: z.string().min(1),
  jobType: z.string().min(1),
  sources: z.array(provenanceSourceSchema).default([]),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  /** Real cost in USD for this run, recorded from the provider's own accounting. */
  costUsd: z.number().nonnegative(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  /** Human who reviewed it, if any. Absent means nobody has. */
  reviewedBy: z.string().optional(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/* ------------------------------------------------------------------ *
 * Affiliate disclosure
 * ------------------------------------------------------------------ */

export const affiliateSchema = z.object({
  /** True when the item contains any affiliate offer, link or code. */
  hasOffers: z.boolean().default(false),
  /**
   * The disclosure text as it will be rendered. Materialised into frontmatter rather
   * than resolved at render time so that what was disclosed is recorded in git history
   * alongside what was published.
   */
  disclosure: z.string().min(1).optional(),
  network: z.string().optional(),
});

export type Affiliate = z.infer<typeof affiliateSchema>;

/* ------------------------------------------------------------------ *
 * Publishing and scheduling
 * ------------------------------------------------------------------ */

export const approvalPolicySchema = z.enum(['human-required', 'human-optional', 'auto']);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const publishWindowSchema = z.object({
  /** Inclusive local start, `HH:MM`. */
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'publishWindow.from must be HH:MM'),
  /** Exclusive local end, `HH:MM`. */
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'publishWindow.to must be HH:MM'),
  /** IANA zone. The window is meaningless without one. */
  timezone: z.string().min(1),
  /** Days the window is open, 0 = Sunday. Empty means every day. */
  days: z.array(z.number().int().min(0).max(6)).default([]),
});

export type PublishWindow = z.infer<typeof publishWindowSchema>;

export const scheduleSchema = z
  .object({
    /** Exact instant to publish. Mutually exclusive with `window`. */
    at: z.coerce.date().optional(),
    /** Randomise within a window, seeded per item so the result is reproducible. */
    window: publishWindowSchema.optional(),
    /** Do not publish before this instant even if approved earlier. */
    embargoUntil: z.coerce.date().optional(),
    /** For `human-optional`: publish anyway if nobody has decided by this instant. */
    reviewDeadline: z.coerce.date().optional(),
  })
  .refine((value) => !(value.at && value.window), {
    message: 'schedule.at and schedule.window are mutually exclusive — pick a fixed time or a window',
    path: ['at'],
  });

export type Schedule = z.infer<typeof scheduleSchema>;

/* ------------------------------------------------------------------ *
 * SEO
 * ------------------------------------------------------------------ */

export const seoSchema = z.object({
  title: z.string().max(70).optional(),
  description: z.string().max(180).optional(),
  canonical: z.string().url().optional(),
  noindex: z.boolean().default(false),
  ogImage: z.string().optional(),
  ogImageAlt: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * The eight required fields
 * ------------------------------------------------------------------ */

/**
 * Named separately because the agent job contract (docs/agent-job-contract.md) and the
 * error messages in the review queue both need this exact list, and a third party
 * implementing against the contract needs it to be one authoritative thing.
 */
export const REQUIRED_ITEM_FIELDS = [
  'title',
  'slug',
  'category',
  'publishedDate',
  'excerpt',
  'locale',
  'author',
  'sourceType',
] as const;

export type RequiredItemField = (typeof REQUIRED_ITEM_FIELDS)[number];

const localeSchema = z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]);

const slugSchema = z
  .string()
  .min(1, 'slug is required')
  .refine(isValidSlug, {
    message:
      'slug must be lowercase, digits and single hyphens only. Thaana titles are transliterated by slugify() — do not percent-encode.',
  });

/* ------------------------------------------------------------------ *
 * Post
 * ------------------------------------------------------------------ */

const postBase = z.object({
  // --- the eight non-negotiable fields ---
  title: z.string().min(1, 'title is required'),
  slug: slugSchema,
  category: z.string().min(1, 'category is required'),
  publishedDate: z.coerce.date({
    required_error: 'publishedDate is required',
    invalid_type_error: 'publishedDate must be a date',
  }),
  excerpt: z.string().min(1, 'excerpt is required').max(400),
  locale: localeSchema,
  author: z.string().min(1, 'author is required'),
  sourceType: sourceTypeSchema,

  // --- everything else ---
  updatedDate: z.coerce.date().optional(),
  tags: z.array(z.string().min(1)).default([]),
  series: z.string().optional(),
  seriesIndex: z.number().int().positive().optional(),

  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
  pinned: z.boolean().default(false),

  heroImage: z.string().optional(),
  heroImageAlt: z.string().optional(),
  heroImageCredit: z.string().optional(),

  seo: seoSchema.default({ noindex: false }),

  state: editorialStateSchema.default('draft'),
  transitions: z.array(transitionSchema).default([]),
  approvalPolicy: approvalPolicySchema.default('human-required'),
  schedule: scheduleSchema.optional(),

  provenance: provenanceSchema.optional(),
  affiliate: affiliateSchema.default({ hasOffers: false }),

  /** Set when this item is a translation of another. */
  translationOf: z.string().optional(),

  /** Site id this item belongs to. Absent in single-site demo content. */
  site: z.string().optional(),
});

/**
 * Cross-field rules. Kept in one `superRefine` so every violation in an item is
 * reported at once -- an editor fixing agent output should see all of it, not one
 * error per save.
 */
function applyItemInvariants(
  value: z.infer<typeof postBase>,
  ctx: z.RefinementCtx,
): void {
  // AI-authored content must carry provenance. Publishing it under a bare human name
  // is the one thing this system must never do.
  if ((value.sourceType === 'ai' || value.sourceType === 'ai-assisted') && !value.provenance) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['provenance'],
      message: `provenance is required when sourceType is "${value.sourceType}" — AI-authored content may never be published as if a human wrote it`,
    });
  }

  // Affiliate disclosure, enforced here rather than in the UI so it also binds agent
  // output, imports and direct commits.
  if (value.affiliate.hasOffers && !value.affiliate.disclosure) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['affiliate', 'disclosure'],
      message:
        'affiliate.disclosure is required when affiliate.hasOffers is true — an item carrying an affiliate offer cannot publish without a disclosure',
    });
  }

  if (value.seriesIndex !== undefined && value.series === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['series'],
      message: 'seriesIndex was given without a series',
    });
  }

  if (value.updatedDate && value.updatedDate < value.publishedDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['updatedDate'],
      message: 'updatedDate is before publishedDate',
    });
  }

  if (value.state === 'scheduled' && !value.schedule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: 'an item in the "scheduled" state must carry a schedule',
    });
  }
}

export const postSchema = postBase.superRefine(applyItemInvariants);
export type Post = z.infer<typeof postSchema>;
export type PostInput = z.input<typeof postSchema>;

/* ------------------------------------------------------------------ *
 * Page, author, category, tag, series
 * ------------------------------------------------------------------ */

export const pageSchema = z.object({
  title: z.string().min(1),
  slug: slugSchema,
  locale: localeSchema,
  excerpt: z.string().max(400).optional(),
  updatedDate: z.coerce.date().optional(),
  draft: z.boolean().default(false),
  seo: seoSchema.default({ noindex: false }),
  state: editorialStateSchema.default('draft'),
  transitions: z.array(transitionSchema).default([]),
  site: z.string().optional(),
});
export type Page = z.infer<typeof pageSchema>;

export const authorSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  bio: z.string().optional(),
  avatar: z.string().optional(),
  /** Present only for human authors; an agent author records its model instead. */
  url: z.string().url().optional(),
  isAgent: z.boolean().default(false),
  locale: localeSchema.optional(),
});
export type Author = z.infer<typeof authorSchema>;

export const categorySchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  description: z.string().optional(),
  locale: localeSchema.optional(),
  parent: z.string().optional(),
});
export type Category = z.infer<typeof categorySchema>;

export const tagSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  locale: localeSchema.optional(),
});
export type Tag = z.infer<typeof tagSchema>;

export const seriesSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  description: z.string().optional(),
  locale: localeSchema.optional(),
});
export type Series = z.infer<typeof seriesSchema>;

/* ------------------------------------------------------------------ *
 * Content type registry
 * ------------------------------------------------------------------ */

export interface ContentTypeDefinition {
  readonly id: string;
  readonly label: string;
  /** Directory under the site's content root. */
  readonly directory: string;
  readonly schema: z.ZodTypeAny;
  /** Whether items of this type appear in feeds, sitemaps and archives. */
  readonly listed: boolean;
  /** Whether items of this type move through the editorial state machine. */
  readonly editorial: boolean;
}

/**
 * Built-in types. A custom type needs one entry here and one schema file --
 * see docs/custom-content-types.md.
 */
export const CONTENT_TYPES: Readonly<Record<string, ContentTypeDefinition>> = Object.freeze({
  post: {
    id: 'post',
    label: 'Post',
    directory: 'posts',
    schema: postSchema,
    listed: true,
    editorial: true,
  },
  page: {
    id: 'page',
    label: 'Page',
    directory: 'pages',
    schema: pageSchema,
    listed: false,
    editorial: true,
  },
  author: {
    id: 'author',
    label: 'Author',
    directory: 'authors',
    schema: authorSchema,
    listed: false,
    editorial: false,
  },
  category: {
    id: 'category',
    label: 'Category',
    directory: 'categories',
    schema: categorySchema,
    listed: false,
    editorial: false,
  },
  tag: { id: 'tag', label: 'Tag', directory: 'tags', schema: tagSchema, listed: false, editorial: false },
  series: {
    id: 'series',
    label: 'Series',
    directory: 'series',
    schema: seriesSchema,
    listed: false,
    editorial: false,
  },
});

/* ------------------------------------------------------------------ *
 * Validation reporting
 * ------------------------------------------------------------------ */

export interface FieldError {
  /** Dotted path, e.g. `affiliate.disclosure`. */
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly errors: readonly FieldError[];
}

/** Flatten a Zod error into field/message pairs an editor can act on. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/** Validate against any content schema and report by field name. */
export function validateItem<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return { ok: false, errors: toFieldErrors(parsed.error) };
}

/** Field names that are missing entirely, as opposed to present but invalid. */
export function missingRequiredFields(input: unknown): RequiredItemField[] {
  if (typeof input !== 'object' || input === null) return [...REQUIRED_ITEM_FIELDS];
  const record = input as Record<string, unknown>;
  return REQUIRED_ITEM_FIELDS.filter((field) => {
    const value = record[field];
    return value === undefined || value === null || value === '';
  });
}
