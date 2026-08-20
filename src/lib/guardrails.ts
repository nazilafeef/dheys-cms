import { z } from 'zod';
import { LOCALE_CODES, findLatinPunctuation, t, type LocaleCode } from './i18n';
import { hasHumanApproval } from './editorial';
import type { Post } from './schemas';

/**
 * Guardrails: declarative, per-site rules that block publication.
 *
 * A guardrail is not a lint and not a warning. If a rule fails, the item does not
 * publish -- the scheduler refuses it, the review queue shows it as blocked, and the
 * operator gets a sentence naming the site, the item and the rule in plain language
 * rather than a stack trace or a rule id.
 *
 * Guardrails apply to every route into a site repository: human commits from the admin,
 * agent output that cleared intake, and scheduled auto-publishes. The `auto` approval
 * policy skips the human step; it does not skip these.
 */

const localeSchema = z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]);

export const guardrailRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('required-fields'),
    /** Dotted paths into the item, e.g. `heroImageAlt` or `seo.description`. */
    fields: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal('banned-phrases'),
    phrases: z.array(z.string().min(1)).min(1),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('minimum-words'),
    count: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('required-disclosure'),
    kind: z.enum(['affiliate', 'ai', 'sponsored']),
  }),
  z.object({
    type: z.literal('human-review-required'),
  }),
  z.object({
    type: z.literal('locale-completeness'),
    locales: z.array(localeSchema).min(1),
  }),
  z.object({
    type: z.literal('thaana-punctuation'),
  }),
]);

export type GuardrailRule = z.infer<typeof guardrailRuleSchema>;
export type GuardrailType = GuardrailRule['type'];

export interface GuardrailContext {
  readonly siteId: string;
  readonly siteName: string;
  readonly item: Post;
  readonly body: string;
  /** Locales this logical item actually exists in, for locale-completeness. */
  readonly availableLocales: readonly LocaleCode[];
  /** Locale the operator-facing message is written in. */
  readonly messageLocale?: LocaleCode;
}

export interface GuardrailViolation {
  readonly rule: GuardrailType;
  readonly siteId: string;
  readonly itemSlug: string;
  /** Plain language, naming site, item and rule. This is what the operator reads. */
  readonly message: string;
}

/**
 * Query parameters and markers that indicate an affiliate offer. An item can carry an
 * affiliate link without anyone having ticked `affiliate.hasOffers`, which is exactly
 * the case the disclosure rule exists to catch, so the body is scanned rather than
 * trusted.
 */
const AFFILIATE_MARKERS: readonly RegExp[] = [
  /[?&](?:tag|ref|aff|affiliate|partner|utm_campaign=affiliate)=/i,
  /\baffiliate\s+link\b/i,
  /<!--\s*affiliate\s*-->/i,
];

export function bodyContainsAffiliateOffer(body: string): boolean {
  return AFFILIATE_MARKERS.some((marker) => marker.test(body));
}

/** Word count that does not treat Markdown syntax or Thaana as words. */
export function countWords(body: string): number {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\d.]+\s/gm, ' ')
    .replace(/[*_~]/g, ' ');
  const matches = stripped.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** Read a dotted path out of the item without `any`. */
function readPath(item: Post, path: string): unknown {
  let cursor: unknown = item;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Evaluate one rule. Returns every violation it finds, not just the first. */
function evaluateRule(rule: GuardrailRule, ctx: GuardrailContext): GuardrailViolation[] {
  const locale = ctx.messageLocale ?? 'en';
  const site = ctx.siteName;
  const item = ctx.item.title;
  const violation = (message: string): GuardrailViolation => ({
    rule: rule.type,
    siteId: ctx.siteId,
    itemSlug: ctx.item.slug,
    message,
  });

  switch (rule.type) {
    case 'required-fields': {
      return rule.fields
        .filter((field) => isEmpty(readPath(ctx.item, field)))
        .map((field) => violation(t(locale, 'guardrail.requiredField', { site, item, field })));
    }

    case 'banned-phrases': {
      const haystack = rule.caseSensitive
        ? `${ctx.item.title}\n${ctx.item.excerpt}\n${ctx.body}`
        : `${ctx.item.title}\n${ctx.item.excerpt}\n${ctx.body}`.toLowerCase();
      return rule.phrases
        .filter((phrase) => haystack.includes(rule.caseSensitive ? phrase : phrase.toLowerCase()))
        .map((phrase) => violation(t(locale, 'guardrail.bannedPhrase', { site, item, phrase })));
    }

    case 'minimum-words': {
      const actual = countWords(ctx.body);
      if (actual >= rule.count) return [];
      return [
        violation(
          t(locale, 'guardrail.minimumWords', { site, item, actual, expected: rule.count }),
        ),
      ];
    }

    case 'required-disclosure': {
      if (rule.kind === 'affiliate') {
        const carriesOffer = ctx.item.affiliate.hasOffers || bodyContainsAffiliateOffer(ctx.body);
        if (!carriesOffer) return [];
        if (ctx.item.affiliate.disclosure) return [];
        return [
          violation(t(locale, 'guardrail.requiredDisclosure', { site, item, kind: rule.kind })),
        ];
      }
      if (rule.kind === 'ai') {
        const isAi = ctx.item.sourceType === 'ai' || ctx.item.sourceType === 'ai-assisted';
        if (!isAi || ctx.item.provenance) return [];
        return [
          violation(t(locale, 'guardrail.requiredDisclosure', { site, item, kind: rule.kind })),
        ];
      }
      // sponsored
      const sponsored = /\bsponsored\b/i.test(ctx.body) || ctx.item.tags.includes('sponsored');
      if (!sponsored || ctx.item.affiliate.disclosure) return [];
      return [
        violation(t(locale, 'guardrail.requiredDisclosure', { site, item, kind: rule.kind })),
      ];
    }

    case 'human-review-required': {
      if (hasHumanApproval(ctx.item)) return [];
      return [violation(t(locale, 'guardrail.humanReviewRequired', { site, item }))];
    }

    case 'locale-completeness': {
      return rule.locales
        .filter((required) => !ctx.availableLocales.includes(required))
        .map((missing) =>
          violation(t(locale, 'guardrail.localeCompleteness', { site, item, locale: missing })),
        );
    }

    case 'thaana-punctuation': {
      const offences = [
        ...findLatinPunctuation(ctx.item.title),
        ...findLatinPunctuation(ctx.item.excerpt),
        ...findLatinPunctuation(ctx.body),
      ];
      const first = offences[0];
      if (!first) return [];
      return [
        violation(t(locale, 'guardrail.thaanaPunctuation', { site, item, index: first.index })),
      ];
    }
  }
}

/**
 * Evaluate every rule for a site. Returns all violations so an operator sees the whole
 * problem at once rather than fixing one and discovering the next.
 */
export function evaluateGuardrails(
  rules: readonly GuardrailRule[],
  ctx: GuardrailContext,
): GuardrailViolation[] {
  return rules.flatMap((rule) => evaluateRule(rule, ctx));
}

/** An item may publish only when nothing blocks it. */
export function mayPublish(
  rules: readonly GuardrailRule[],
  ctx: GuardrailContext,
): { allowed: boolean; violations: GuardrailViolation[] } {
  const violations = evaluateGuardrails(rules, ctx);
  return { allowed: violations.length === 0, violations };
}

/**
 * Rules every site gets unless it replaces them.
 *
 * The affiliate disclosure rule ships in this set deliberately: an operator who never
 * opens the guardrail configuration still cannot publish an item carrying an affiliate
 * offer without disclosing it. Undisclosed affiliate content is a legal exposure in
 * most jurisdictions the CMS is likely to be used in, so opting *in* would be the wrong
 * default.
 */
export const DEFAULT_GUARDRAILS: readonly GuardrailRule[] = Object.freeze([
  { type: 'required-disclosure', kind: 'affiliate' },
  { type: 'required-disclosure', kind: 'ai' },
  { type: 'thaana-punctuation' },
]);

/** Parse rules from a site definition, reporting a usable error on a bad rule. */
export function parseGuardrails(input: unknown): GuardrailRule[] {
  const parsed = z.array(guardrailRuleSchema).safeParse(input);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid guardrail configuration — ${detail}`);
}
