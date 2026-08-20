import { describe, it, expect } from 'vitest';
import {
  slugify,
  uniqueSlug,
  isValidSlug,
  transliterateThaana,
  transliterateArabic,
  containsThaanaChar,
  containsArabicChar,
} from '@lib/slug';

/**
 * Slug generation for three scripts.
 *
 * The failure this guards against is not cosmetic: a naive slugger strips every non-Latin
 * character, so a Dhivehi headline yields the empty string and falls back to a constant.
 * Two such headlines then collide on one URL and a route silently disappears. That exact
 * bug shipped in this build for Arabic and was caught by `pnpm check:links`.
 */

describe('Thaana transliteration', () => {
  it('reads a consonant together with its fili', () => {
    // ދި = dhaviyani + ibifili -> "dhi"
    expect(transliterateThaana('ދި')).toBe('dhi');
    expect(transliterateThaana('ބަ')).toBe('ba');
    expect(transliterateThaana('ކޮ')).toBe('ko');
  });

  it('treats sukun as an explicit absence of a vowel', () => {
    expect(transliterateThaana('ބްް'.slice(0, 2))).toBe('b');
  });

  it('transliterates a real headline into something pronounceable', () => {
    expect(transliterateThaana('ބަނދަރު')).toBe('bandharu');
    expect(transliterateThaana('ދިވެހި')).toBe('dhivehi');
  });

  it('treats alifu as a silent vowel carrier', () => {
    expect(transliterateThaana('އަ')).toBe('a');
  });

  it('lets non-Thaana characters through untouched', () => {
    expect(transliterateThaana('iOS 26 ގައި')).toBe('iOS 26 gai');
  });

  it('detects Thaana', () => {
    expect(containsThaanaChar('ބަނދަރު')).toBe(true);
    expect(containsThaanaChar('harbour')).toBe(false);
  });
});

describe('Arabic transliteration', () => {
  it('romanises a name', () => {
    expect(transliterateArabic('آمنة رشيد')).toBe('aamnh rshyd');
    expect(transliterateArabic('إبراهيم وحيد')).toBe('ibrahym whyd');
  });

  it('drops harakat, which carry nothing in a URL', () => {
    expect(transliterateArabic('مُحَمَّد')).toBe(transliterateArabic('محمد'));
  });

  it('detects Arabic', () => {
    expect(containsArabicChar('مقياس')).toBe(true);
    expect(containsArabicChar('mikyas')).toBe(false);
  });
});

describe('slugify', () => {
  it('produces a readable slug from Latin text', () => {
    expect(slugify('The tide gauge at the old harbour')).toBe('the-tide-gauge-at-the-old-harbour');
  });

  it('produces a non-empty, valid slug from Thaana', () => {
    const slug = slugify('ބަނދަރުގެ ދިޔަވަރު މާޕު');
    expect(slug).not.toBe('untitled');
    expect(isValidSlug(slug)).toBe(true);
    expect(slug).toContain('bandharu');
  });

  it('produces a non-empty, valid slug from Arabic', () => {
    const slug = slugify('مقياس المد في الميناء القديم');
    expect(slug).not.toBe('untitled');
    expect(isValidSlug(slug)).toBe(true);
  });

  it('gives two different Arabic names two different slugs', () => {
    // The collision that produced two pages at /ar/author/untitled.
    expect(slugify('آمنة رشيد')).not.toBe(slugify('إبراهيم وحيد'));
  });

  it('folds Latin accents rather than dropping the letters', () => {
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
    expect(slugify('Straße')).toBe('strasse');
  });

  it('strips quotes instead of turning them into separators', () => {
    expect(slugify("What a newsroom's readers expect")).toBe('what-a-newsrooms-readers-expect');
  });

  it('never emits leading, trailing or doubled hyphens', () => {
    for (const input of ['  spaced  ', '--dashes--', 'a  b', '!!!x!!!']) {
      const slug = slugify(input);
      expect(slug).not.toMatch(/^-|-$|--/);
    }
  });

  it('falls back only when there is genuinely nothing to romanise', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('!!!', 'fallback')).toBe('fallback');
  });
});

describe('isValidSlug', () => {
  it.each(['a', 'a-b', 'post-1', 'the-tide-gauge'])('accepts %j', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(['A', 'a_b', '-a', 'a-', 'a--b', 'ބަނދަރު', 'a b'])('rejects %j', (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when nothing has taken it', () => {
    expect(uniqueSlug('A new post', [])).toBe('a-new-post');
  });

  it('counts up rather than hashing, because an editor has to read these', () => {
    expect(uniqueSlug('A new post', ['a-new-post'])).toBe('a-new-post-2');
    expect(uniqueSlug('A new post', ['a-new-post', 'a-new-post-2'])).toBe('a-new-post-3');
  });

  it('skips a gap rather than reusing a taken suffix', () => {
    expect(uniqueSlug('post', ['post', 'post-2', 'post-3'])).toBe('post-4');
  });

  it('works for Thaana titles too', () => {
    const first = slugify('ބަނދަރު');
    expect(uniqueSlug('ބަނދަރު', [first])).toBe(`${first}-2`);
  });
});
