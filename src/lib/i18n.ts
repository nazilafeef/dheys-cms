/**
 * Locales, direction and translation lookup.
 *
 * RTL is not a skin here. Dhivehi (Thaana) is a shipped, first-class locale, Arabic is
 * carried as a second RTL locale so a bug that only shows up in one script cannot hide,
 * and English is the LTR control. Everything that differs per locale -- direction,
 * script, comfortable measure, date formatting, punctuation -- is declared once in
 * `LOCALES` and read from there. No component may branch on a locale code directly.
 */

import en from '../locales/en.json' with { type: 'json' };
import dv from '../locales/dv.json' with { type: 'json' };
import ar from '../locales/ar.json' with { type: 'json' };
import { normaliseBase, withBase, stripBase } from './paths';

export type LocaleCode = 'en' | 'dv' | 'ar';
export type Direction = 'ltr' | 'rtl';

export interface LocaleDefinition {
  /** BCP 47 code, used verbatim in `lang`, `hreflang` and the URL segment. */
  readonly code: LocaleCode;
  /** English name, for operator-facing UI in the admin's own language. */
  readonly name: string;
  /** Endonym, shown to readers. */
  readonly nativeName: string;
  readonly dir: Direction;
  /** ISO 15924 script code. */
  readonly script: 'Latn' | 'Thaa' | 'Arab';
  /**
   * Comfortable line length for body text. Thaana sets tighter than Latin because its
   * glyphs are wider and its diacritics sit above and below the baseline.
   */
  readonly measureCh: number;
  /** Locale tag handed to Intl for dates and numbers. */
  readonly intlTag: string;
}

export const LOCALES: Readonly<Record<LocaleCode, LocaleDefinition>> = Object.freeze({
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
    script: 'Latn',
    measureCh: 68,
    intlTag: 'en-GB',
  },
  dv: {
    code: 'dv',
    name: 'Dhivehi',
    nativeName: 'ދިވެހި',
    dir: 'rtl',
    script: 'Thaa',
    measureCh: 62,
    intlTag: 'dv-MV',
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
    script: 'Arab',
    measureCh: 62,
    intlTag: 'ar',
  },
});

export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[];
export const DEFAULT_LOCALE: LocaleCode = 'en';

/** Thaana block, including the fili (vowel marks) and sukun. */
const THAANA_RANGE = /[ހ-޿]/;

/**
 * Punctuation Dhivehi text must use. Latin `,` `;` `?` inside Thaana render with the
 * wrong directional class and visibly break the run -- this is a correctness rule, not
 * a style preference, so `findLatinPunctuation` backs a guardrail rather than a lint.
 */
export const THAANA_PUNCTUATION = Object.freeze({
  comma: '،',
  semicolon: '؛',
  question: '؟',
});

const LATIN_TO_THAANA_PUNCTUATION: ReadonlyArray<readonly [string, string]> = [
  [',', THAANA_PUNCTUATION.comma],
  [';', THAANA_PUNCTUATION.semicolon],
  ['?', THAANA_PUNCTUATION.question],
];

export function isLocaleCode(value: string): value is LocaleCode {
  return Object.prototype.hasOwnProperty.call(LOCALES, value);
}

export function getLocale(code: string): LocaleDefinition {
  if (!isLocaleCode(code)) {
    throw new Error(
      `Unknown locale "${code}". Known locales: ${LOCALE_CODES.join(', ')}. Add it to LOCALES in src/lib/i18n.ts and ship a matching src/locales/${code}.json.`,
    );
  }
  return LOCALES[code];
}

export function isRtl(code: string): boolean {
  return getLocale(code).dir === 'rtl';
}

export function directionOf(code: string): Direction {
  return getLocale(code).dir;
}

/** True when the string contains any Thaana character. */
export function containsThaana(text: string): boolean {
  return THAANA_RANGE.test(text);
}

/**
 * Locate Latin punctuation used inside Thaana text.
 * Returns every offence with its index so an editor can be pointed at the character.
 */
export function findLatinPunctuation(text: string): Array<{ char: string; index: number }> {
  if (!containsThaana(text)) return [];
  const offenders: Array<{ char: string; index: number }> = [];
  const latin = new Set(LATIN_TO_THAANA_PUNCTUATION.map(([from]) => from));
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== undefined && latin.has(char)) offenders.push({ char, index });
  }
  return offenders;
}

/** Rewrite Latin `,` `;` `?` to their Thaana equivalents, but only in Thaana text. */
export function normaliseThaanaPunctuation(text: string): string {
  if (!containsThaana(text)) return text;
  return LATIN_TO_THAANA_PUNCTUATION.reduce(
    (acc, [from, to]) => acc.split(from).join(to),
    text,
  );
}

/**
 * Locale-prefixed route. The default locale is served without a prefix so the primary
 * language keeps clean URLs; every other locale gets `/{code}/...`.
 */
export function localePath(path: string, locale: LocaleCode, base?: string): string {
  const appPath = stripBase(path, base);
  const clean = appPath === '/' ? '' : appPath;
  if (locale === DEFAULT_LOCALE) return withBase(clean === '' ? '/' : clean, base);
  return withBase(`/${locale}${clean}`, base);
}

/**
 * Read the locale out of a request pathname, tolerating the deployment base.
 * Returns the default locale and the untouched path when there is no locale segment.
 */
export function localeFromPath(
  pathname: string,
  base?: string,
): { locale: LocaleCode; path: string } {
  const appPath = stripBase(pathname, base);
  const [, first = '', ...rest] = appPath.split('/');
  if (isLocaleCode(first) && first !== DEFAULT_LOCALE) {
    const remainder = `/${rest.join('/')}`.replace(/\/+$/, '');
    return { locale: first, path: remainder === '' ? '/' : remainder };
  }
  return { locale: DEFAULT_LOCALE, path: appPath };
}

/** `hreflang` set for one logical page across every locale it exists in. */
export function hreflangAlternates(
  path: string,
  availableLocales: readonly LocaleCode[],
  site: string,
  base?: string,
): Array<{ hreflang: string; href: string }> {
  const origin = site.endsWith('/') ? site.slice(0, -1) : site;
  const alternates: Array<{ hreflang: string; href: string }> = availableLocales.map((locale) => ({
    hreflang: locale as string,
    href: `${origin}${localePath(path, locale, base)}`,
  }));
  if (availableLocales.includes(DEFAULT_LOCALE)) {
    alternates.push({
      hreflang: 'x-default',
      href: `${origin}${localePath(path, DEFAULT_LOCALE, base)}`,
    });
  }
  return alternates;
}

/* ------------------------------------------------------------------ *
 * Translation lookup
 * ------------------------------------------------------------------ */

type Messages = Record<string, string>;

const MESSAGES: Readonly<Record<LocaleCode, Messages>> = Object.freeze({
  en: en as Messages,
  dv: dv as Messages,
  ar: ar as Messages,
});

/**
 * Translate a dotted key. Falls back to the default locale, then to the key itself, so
 * a missing string degrades to something diagnosable rather than to `undefined` in the
 * page. `{placeholders}` are substituted from `vars`.
 */
export function t(
  locale: LocaleCode,
  key: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const fallback = MESSAGES[DEFAULT_LOCALE];
  const template = table[key] ?? fallback[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/** Bind `t` to one locale, which is what layouts and components actually use. */
export function translator(locale: LocaleCode) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string =>
    t(locale, key, vars ?? {});
}

/** Keys present in the default locale but missing from `locale`. */
export function missingKeys(locale: LocaleCode): string[] {
  const base = MESSAGES[DEFAULT_LOCALE];
  const table = MESSAGES[locale];
  return Object.keys(base).filter((key) => table[key] === undefined);
}

/** Format a date for display, honouring the locale's calendar conventions. */
export function formatDate(date: Date | string, locale: LocaleCode, timeZone = 'UTC'): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(getLocale(locale).intlTag, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(value);
}

/** Machine-readable date for `<time datetime>`, always ISO 8601 in UTC. */
export function isoDate(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toISOString();
}

/** The canonical base, re-exported so components need only import from i18n. */
export { normaliseBase };
