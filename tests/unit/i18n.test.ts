import { describe, it, expect } from 'vitest';
import {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  getLocale,
  isRtl,
  directionOf,
  containsThaana,
  findLatinPunctuation,
  normaliseThaanaPunctuation,
  THAANA_PUNCTUATION,
  localePath,
  localeFromPath,
  hreflangAlternates,
  t,
  translator,
  missingKeys,
  formatDate,
} from '@lib/i18n';

describe('locale definitions', () => {
  it('ships English, Dhivehi and Arabic', () => {
    expect(LOCALE_CODES.sort()).toEqual(['ar', 'dv', 'en']);
  });

  it('carries two right-to-left locales, so an RTL bug cannot hide in one script', () => {
    const rtl = LOCALE_CODES.filter((code) => isRtl(code));
    expect(rtl.sort()).toEqual(['ar', 'dv']);
  });

  it('names each locale in its own script for the switcher', () => {
    expect(LOCALES.dv.nativeName).toBe('ދިވެހި');
    expect(LOCALES.ar.nativeName).toBe('العربية');
  });

  it('sets a tighter measure for Thaana and Arabic than for Latin', () => {
    expect(LOCALES.en.measureCh).toBe(68);
    expect(LOCALES.dv.measureCh).toBe(62);
    expect(LOCALES.ar.measureCh).toBe(62);
  });

  it('reports direction per locale', () => {
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('dv')).toBe('rtl');
  });

  it('names the fix when asked for a locale that does not exist', () => {
    expect(() => getLocale('fr')).toThrow(/Add it to LOCALES/);
  });
});

describe('Thaana punctuation', () => {
  it('uses the Arabic-script marks, not Latin ones', () => {
    expect(THAANA_PUNCTUATION.comma).toBe('،');
    expect(THAANA_PUNCTUATION.semicolon).toBe('؛');
    expect(THAANA_PUNCTUATION.question).toBe('؟');
  });

  it('flags Latin punctuation inside Thaana text, with its position', () => {
    const offenders = findLatinPunctuation('ދިވެހި, ބަސް');
    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.char).toBe(',');
    expect(offenders[0]?.index).toBe(6);
  });

  it('flags every offender, not just the first', () => {
    expect(findLatinPunctuation('ދިވެހި, ބަސް; ކޮބާ?')).toHaveLength(3);
  });

  it('leaves Latin text alone — this rule is about Thaana, not about commas', () => {
    expect(findLatinPunctuation('Hello, world; really?')).toEqual([]);
  });

  it('rewrites Latin punctuation to the Thaana equivalents', () => {
    const fixed = normaliseThaanaPunctuation('ދިވެހި, ބަސް; ކޮބާ?');
    expect(fixed).toContain('،');
    expect(fixed).toContain('؛');
    expect(fixed).toContain('؟');
    expect(findLatinPunctuation(fixed)).toEqual([]);
  });

  it('does not touch a string with no Thaana in it', () => {
    const latin = 'Hello, world?';
    expect(normaliseThaanaPunctuation(latin)).toBe(latin);
  });

  it('detects Thaana', () => {
    expect(containsThaana('ދިވެހި')).toBe(true);
    expect(containsThaana('العربية')).toBe(false);
  });
});

describe('locale routing', () => {
  const base = '/dheys-cms';

  it('serves the default locale without a prefix', () => {
    expect(localePath('/', 'en', base)).toBe('/dheys-cms/');
    expect(localePath('/archive', 'en', base)).toBe('/dheys-cms/archive');
  });

  it('prefixes every other locale', () => {
    expect(localePath('/archive', 'dv', base)).toBe('/dheys-cms/dv/archive');
    expect(localePath('/', 'ar', base)).toBe('/dheys-cms/ar');
  });

  it('works under root hosting too', () => {
    expect(localePath('/archive', 'dv', '/')).toBe('/dv/archive');
    expect(localePath('/archive', 'en', '/')).toBe('/archive');
  });

  it('reads the locale back out of a path', () => {
    expect(localeFromPath('/dheys-cms/dv/archive', base)).toEqual({
      locale: 'dv',
      path: '/archive',
    });
    expect(localeFromPath('/dheys-cms/archive', base)).toEqual({
      locale: 'en',
      path: '/archive',
    });
  });

  it('round-trips path -> localePath -> localeFromPath', () => {
    for (const locale of LOCALE_CODES) {
      const built = localePath('/archive', locale, base);
      expect(localeFromPath(built, base).locale).toBe(locale);
    }
  });
});

describe('hreflang', () => {
  it('emits one entry per locale plus x-default', () => {
    const alternates = hreflangAlternates('/archive', ['en', 'dv'], 'https://example.test', '/');
    expect(alternates.map((a) => a.hreflang)).toEqual(['en', 'dv', 'x-default']);
    expect(alternates[0]?.href).toBe('https://example.test/archive');
    expect(alternates[1]?.href).toBe('https://example.test/dv/archive');
  });

  it('points x-default at the default locale', () => {
    const alternates = hreflangAlternates('/', ['en', 'ar'], 'https://example.test', '/');
    const xDefault = alternates.find((a) => a.hreflang === 'x-default');
    const english = alternates.find((a) => a.hreflang === 'en');
    expect(xDefault?.href).toBe(english?.href);
  });
});

describe('translation', () => {
  it('substitutes named placeholders', () => {
    expect(t('en', 'article.by', { author: 'A. Editor' })).toBe('By A. Editor');
  });

  it('leaves an unknown placeholder visible rather than printing undefined', () => {
    expect(t('en', 'article.by', {})).toBe('By {author}');
  });

  it('falls back to the key itself, so a missing string is diagnosable', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key');
  });

  it('binds to one locale for components', () => {
    const translate = translator('dv');
    expect(translate('nav.search')).toBe('ހޯދާ');
  });

  it('renders Dhivehi and Arabic, not English, for their own locales', () => {
    expect(t('dv', 'nav.home')).not.toBe(t('en', 'nav.home'));
    expect(t('ar', 'nav.home')).not.toBe(t('en', 'nav.home'));
    expect(containsThaana(t('dv', 'nav.home'))).toBe(true);
  });
});

describe('locale completeness', () => {
  // A missing key silently falls back to English, which is exactly the failure that ships
  // a half-translated interface without anybody noticing.
  it.each(LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE))(
    '%s defines every key English defines',
    (locale) => {
      expect(missingKeys(locale)).toEqual([]);
    },
  );

  it('reports nothing missing for the default locale', () => {
    expect(missingKeys(DEFAULT_LOCALE)).toEqual([]);
  });
});

describe('date formatting', () => {
  it('formats in the locale calendar and stays stable across zones', () => {
    const date = new Date('2026-03-04T09:00:00.000Z');
    expect(formatDate(date, 'en')).toContain('2026');
    expect(formatDate(date, 'ar')).not.toBe(formatDate(date, 'en'));
  });

  it('reads an ISO string as readily as a Date', () => {
    expect(formatDate('2026-03-04T09:00:00.000Z', 'en')).toBe(
      formatDate(new Date('2026-03-04T09:00:00.000Z'), 'en'),
    );
  });
});
