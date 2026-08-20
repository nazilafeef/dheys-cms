import { describe, it, expect } from 'vitest';
import {
  evaluateGuardrails,
  mayPublish,
  parseGuardrails,
  countWords,
  bodyContainsAffiliateOffer,
  DEFAULT_GUARDRAILS,
  type GuardrailContext,
  type GuardrailRule,
} from '@lib/guardrails';
import { transition } from '@lib/editorial';
import { makePost, sampleProvenance } from '../fixtures/items';
import type { Actor } from '@lib/schemas';

const HUMAN: Actor = { kind: 'human', id: 'example-editor' };
const SYSTEM: Actor = { kind: 'system', id: 'scheduler' };

function context(
  overrides: Record<string, unknown> = {},
  body = 'word '.repeat(400),
  extra: Partial<GuardrailContext> = {},
): GuardrailContext {
  return {
    siteId: 'example-news',
    siteName: 'Example News',
    item: makePost(overrides),
    body,
    availableLocales: ['en'],
    messageLocale: 'en',
    ...extra,
  };
}

describe('the default rule set', () => {
  it('ships the affiliate disclosure rule, opted in rather than out', () => {
    expect(
      DEFAULT_GUARDRAILS.some(
        (rule) => rule.type === 'required-disclosure' && rule.kind === 'affiliate',
      ),
    ).toBe(true);
  });

  it('ships the AI disclosure and Thaana punctuation rules too', () => {
    const types = DEFAULT_GUARDRAILS.map((rule) => rule.type);
    expect(types).toContain('required-disclosure');
    expect(types).toContain('thaana-punctuation');
  });
});

describe('affiliate disclosure', () => {
  const rules: GuardrailRule[] = [{ type: 'required-disclosure', kind: 'affiliate' }];

  it('blocks an item that declares an offer with no disclosure', () => {
    // The schema also refuses this, so the item is constructed past it deliberately: the
    // guardrail is the second line of defence for a hand-edited or imported file.
    const ctx = context();
    const item = { ...ctx.item, affiliate: { hasOffers: true } };
    const violations = evaluateGuardrails(rules, { ...ctx, item });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('required-disclosure');
    expect(violations[0]?.message).toContain('Example News');
    expect(violations[0]?.message).toContain('affiliate');
  });

  it('names the site and the item in plain language', () => {
    const ctx = context({ title: 'Choosing a tide clock' });
    const item = { ...ctx.item, affiliate: { hasOffers: true } };
    const [violation] = evaluateGuardrails(rules, { ...ctx, item });

    expect(violation?.message).toBe(
      'Example News: “Choosing a tide clock” needs the affiliate disclosure before it can publish.',
    );
  });

  it('passes once the disclosure is present', () => {
    const ctx = context({
      affiliate: { hasOffers: true, disclosure: 'Contains affiliate links.' },
    });
    expect(evaluateGuardrails(rules, ctx)).toEqual([]);
  });

  it('catches an affiliate link nobody ticked the box for', () => {
    // The case the rule exists for: an offer in the body with `hasOffers` left false.
    const body = 'Buy it here: https://example.com/product?tag=example-network-21';
    expect(bodyContainsAffiliateOffer(body)).toBe(true);
    expect(evaluateGuardrails(rules, context({}, body))).toHaveLength(1);
  });

  it.each([
    'https://example.com/x?ref=abc',
    'https://example.com/x?aff=1',
    'https://example.com/x&partner=y',
    'This is an affiliate link.',
    '<!-- affiliate -->',
  ])('recognises %j as an offer', (body) => {
    expect(bodyContainsAffiliateOffer(body)).toBe(true);
  });

  it('does not see an offer in an ordinary link', () => {
    expect(bodyContainsAffiliateOffer('Read https://example.com/article for more.')).toBe(false);
  });

  it('blocks publication outright, not just warns', () => {
    const ctx = context();
    const item = { ...ctx.item, affiliate: { hasOffers: true } };
    expect(mayPublish(rules, { ...ctx, item }).allowed).toBe(false);
  });
});

describe('AI disclosure', () => {
  const rules: GuardrailRule[] = [{ type: 'required-disclosure', kind: 'ai' }];

  it('blocks AI-authored content with no provenance', () => {
    const ctx = context();
    const item = { ...ctx.item, sourceType: 'ai' as const, provenance: undefined };
    expect(evaluateGuardrails(rules, { ...ctx, item })).toHaveLength(1);
  });

  it('passes AI content that carries provenance', () => {
    const ctx = context({ sourceType: 'ai', provenance: sampleProvenance() });
    expect(evaluateGuardrails(rules, ctx)).toEqual([]);
  });

  it('ignores human-written content', () => {
    expect(evaluateGuardrails(rules, context())).toEqual([]);
  });
});

describe('required fields', () => {
  const rules: GuardrailRule[] = [
    { type: 'required-fields', fields: ['heroImageAlt', 'seo.description'] },
  ];

  it('reports each missing field separately', () => {
    const violations = evaluateGuardrails(rules, context());
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain('heroImageAlt');
    expect(violations[1]?.message).toContain('seo.description');
  });

  it('reads a dotted path into the item', () => {
    const ctx = context({
      heroImageAlt: 'A brass dial.',
      seo: { description: 'A description.', noindex: false },
    });
    expect(evaluateGuardrails(rules, ctx)).toEqual([]);
  });

  it('treats an empty string and an empty array as missing', () => {
    const ctx = context({ heroImageAlt: '   ', seo: { description: '', noindex: false } });
    expect(evaluateGuardrails(rules, ctx)).toHaveLength(2);
  });
});

describe('banned phrases', () => {
  it('is case-insensitive by default', () => {
    const rules: GuardrailRule[] = [
      { type: 'banned-phrases', phrases: ['guaranteed returns'], caseSensitive: false },
    ];
    const violations = evaluateGuardrails(rules, context({}, 'Offering GUARANTEED RETURNS today.'));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('guaranteed returns');
  });

  it('searches the title and excerpt as well as the body', () => {
    const rules: GuardrailRule[] = [
      { type: 'banned-phrases', phrases: ['risk free'], caseSensitive: false },
    ];
    expect(evaluateGuardrails(rules, context({ title: 'A risk free bet' }, 'Body.'))).toHaveLength(
      1,
    );
  });

  it('reports each banned phrase found', () => {
    const rules: GuardrailRule[] = [
      { type: 'banned-phrases', phrases: ['one', 'two'], caseSensitive: false },
    ];
    expect(evaluateGuardrails(rules, context({}, 'one and two'))).toHaveLength(2);
  });
});

describe('minimum words', () => {
  it('blocks a body that is too short, quoting both numbers', () => {
    const violations = evaluateGuardrails(
      [{ type: 'minimum-words', count: 250 }],
      context({}, 'Only a handful of words here.'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/is 6 words/);
    expect(violations[0]?.message).toMatch(/at least 250/);
  });

  it('passes a long enough body', () => {
    expect(evaluateGuardrails([{ type: 'minimum-words', count: 250 }], context())).toEqual([]);
  });

  it('does not count code blocks or Markdown syntax as words', () => {
    const body = '# Heading\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nOne two three.';
    expect(countWords(body)).toBe(4);
  });

  it('counts Thaana words', () => {
    expect(countWords('ދިވެހި ބަސް')).toBe(2);
  });
});

describe('human review required', () => {
  const rules: GuardrailRule[] = [{ type: 'human-review-required' }];

  it('blocks an item nobody approved', () => {
    expect(evaluateGuardrails(rules, context())).toHaveLength(1);
  });

  it('passes once a person approved it', () => {
    const base = makePost({ state: 'in-review' });
    const item = transition(base, 'approved', HUMAN, { at: new Date('2026-06-01T00:00:00.000Z') });
    expect(evaluateGuardrails(rules, context({}, 'word '.repeat(400), { item }))).toEqual([]);
  });

  it('is NOT satisfied by the scheduler auto-approving on a lapsed deadline', () => {
    const base = makePost({ state: 'in-review' });
    const item = transition(base, 'approved', SYSTEM, { at: new Date('2026-06-01T00:00:00.000Z') });
    expect(evaluateGuardrails(rules, context({}, 'word '.repeat(400), { item }))).toHaveLength(1);
  });
});

describe('locale completeness', () => {
  it('blocks when a required translation is missing', () => {
    const violations = evaluateGuardrails(
      [{ type: 'locale-completeness', locales: ['dv', 'en'] }],
      context({}, 'body', { availableLocales: ['en'] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('dv');
  });

  it('passes when every required locale exists', () => {
    expect(
      evaluateGuardrails(
        [{ type: 'locale-completeness', locales: ['dv', 'en'] }],
        context({}, 'body', { availableLocales: ['en', 'dv'] }),
      ),
    ).toEqual([]);
  });
});

describe('Thaana punctuation', () => {
  const rules: GuardrailRule[] = [{ type: 'thaana-punctuation' }];

  it('blocks Latin punctuation inside Thaana text and gives its position', () => {
    const ctx = context(
      {
        title: 'ދިވެހި ސުރުޚީ',
        locale: 'dv',
        slug: 'dhivehi-surukhee',
        author: 'އެޑިޓަރު',
        excerpt: 'ކުރު ޚުލާޞާ',
      },
      'ދިވެހި, ބަސް',
    );
    const violations = evaluateGuardrails(rules, ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/Latin punctuation inside Thaana text at position/);
  });

  it('passes Thaana that uses the right marks', () => {
    const ctx = context(
      {
        title: 'ދިވެހި ސުރުޚީ',
        locale: 'dv',
        slug: 'dhivehi-surukhee',
        author: 'އެޑިޓަރު',
        excerpt: 'ކުރު ޚުލާޞާ',
      },
      'ދިވެހި، ބަސް؛ ކޮބާ؟',
    );
    expect(evaluateGuardrails(rules, ctx)).toEqual([]);
  });

  it('leaves English content alone', () => {
    expect(evaluateGuardrails(rules, context({}, 'Hello, world; really?'))).toEqual([]);
  });
});

describe('evaluating a whole rule set', () => {
  it('returns every violation at once rather than stopping at the first', () => {
    const rules: GuardrailRule[] = [
      { type: 'minimum-words', count: 250 },
      { type: 'required-fields', fields: ['heroImageAlt'] },
      { type: 'human-review-required' },
    ];
    expect(evaluateGuardrails(rules, context({}, 'Short.'))).toHaveLength(3);
  });

  it('allows publication only when nothing blocks it', () => {
    const verdict = mayPublish([{ type: 'minimum-words', count: 10 }], context());
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
  });
});

describe('parsing configuration', () => {
  it('accepts a valid rule set', () => {
    expect(parseGuardrails([{ type: 'minimum-words', count: 250 }])).toHaveLength(1);
  });

  it('rejects an unknown rule type with a usable message', () => {
    expect(() => parseGuardrails([{ type: 'vibes-check' }])).toThrow(
      /Invalid guardrail configuration/,
    );
  });

  it('rejects a malformed rule of a known type', () => {
    expect(() => parseGuardrails([{ type: 'minimum-words', count: -5 }])).toThrow(
      /Invalid guardrail configuration/,
    );
  });
});
