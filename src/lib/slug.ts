/**
 * Slug generation, including Thaana transliteration.
 *
 * A Dhivehi headline slugged naively either yields an empty string (every character
 * stripped as "non-Latin") or a percent-encoded URL nobody can read or link to by hand.
 * Neither is acceptable for a CMS that ships Dhivehi as a first-class locale, so Thaana
 * is transliterated character by character into the Latin romanisation Maldivian
 * readers already use for URLs and email addresses.
 *
 * The mapping is deliberately explicit rather than clever: consonants carry an implicit
 * vowel supplied by the following fili (vowel mark), and sukun (U+07B0) marks its
 * absence. Reading a consonant and its fili as a pair is what makes the output
 * pronounceable instead of a run of bare consonants.
 */

/** Thaana consonants (U+0780–U+07A5) plus the Arabic-derived set used in loanwords. */
const THAANA_CONSONANTS: Readonly<Record<string, string>> = Object.freeze({
  ހ: 'h',
  ށ: 'sh',
  ނ: 'n',
  ރ: 'r',
  ބ: 'b',
  ޅ: 'lh',
  ކ: 'k',
  އ: '', // alifu — a vowel carrier, silent on its own
  ވ: 'v',
  މ: 'm',
  ފ: 'f',
  ދ: 'dh',
  ތ: 'th',
  ލ: 'l',
  ގ: 'g',
  ޏ: 'gn',
  ސ: 's',
  ޑ: 'd',
  ޒ: 'z',
  ޓ: 't',
  ޔ: 'y',
  ޕ: 'p',
  ޖ: 'j',
  ޗ: 'ch',
  // Thaana letters used to write Arabic loanwords.
  ޘ: 'th',
  ޙ: 'h',
  ޚ: 'kh',
  ޛ: 'dh',
  ޜ: 'z',
  ޝ: 'sh',
  ޞ: 's',
  ޟ: 'dh',
  ޠ: 't',
  ޡ: 'z',
  ޢ: 'a',
  ޣ: 'gh',
  ޤ: 'q',
  ޥ: 'w',
});

/** Fili -- the vowel marks that follow a consonant (U+07A6..U+07B0).
 *
 * Written as escapes rather than as literal characters: a combining mark on its own is
 * invisible in an editor, is not a valid bare object key, and is silently altered by
 * anything that normalises Unicode. The escape is unambiguous to both the reader and
 * the parser.
 */
const THAANA_FILI: Readonly<Record<string, string>> = Object.freeze({
  '\u07A6': 'a', // abafili
  '\u07A7': 'aa', // aabaafili
  '\u07A8': 'i', // ibifili
  '\u07A9': 'ee', // eebeefili
  '\u07AA': 'u', // ubufili
  '\u07AB': 'oo', // ooboofili
  '\u07AC': 'e', // ebefili
  '\u07AD': 'ey', // eybeyfili
  '\u07AE': 'o', // obofili
  '\u07AF': 'oa', // oaboafili
  '\u07B0': '', // sukun -- explicitly no vowel
});

/** Latin transliteration for common Latin-1 accents, so European names slug cleanly. */
const LATIN_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/[àáâãäåāăą]/g, 'a'],
  [/[çćĉċč]/g, 'c'],
  [/[ďđ]/g, 'd'],
  [/[èéêëēĕėęě]/g, 'e'],
  [/[ĝğġģ]/g, 'g'],
  [/[ĥħ]/g, 'h'],
  [/[ìíîïĩīĭįı]/g, 'i'],
  [/[ĵ]/g, 'j'],
  [/[ķ]/g, 'k'],
  [/[ĺļľŀł]/g, 'l'],
  [/[ñńņňŉ]/g, 'n'],
  [/[òóôõöøōŏő]/g, 'o'],
  [/[ŕŗř]/g, 'r'],
  [/[śŝşš]/g, 's'],
  [/[ţťŧ]/g, 't'],
  [/[ùúûüũūŭůűų]/g, 'u'],
  [/[ŵ]/g, 'w'],
  [/[ýÿŷ]/g, 'y'],
  [/[źżž]/g, 'z'],
  [/[æ]/g, 'ae'],
  [/[œ]/g, 'oe'],
  [/[ß]/g, 'ss'],
  [/[þ]/g, 'th'],
  [/[ð]/g, 'dh'],
];

/**
 * Arabic transliteration.
 *
 * Arabic is a shipped locale, and without this an Arabic byline or headline slugs to the
 * empty string and falls back to `untitled` -- which collides the moment there are two of
 * them, and a route collision silently drops a page. Found exactly that way: two Arabic
 * authors both produced `/ar/author/untitled`.
 *
 * This is a practical romanisation for URLs, not a scholarly one: no macrons, no dots
 * under, nothing that needs a diacritic to be readable in an address bar.
 */
const ARABIC_LETTERS: Readonly<Record<string, string>> = Object.freeze({
  ا: 'a',
  أ: 'a',
  إ: 'i',
  آ: 'aa',
  ب: 'b',
  ت: 't',
  ة: 'h',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'w',
  ي: 'y',
  ى: 'a',
  ء: '',
  ؤ: 'u',
  ئ: 'i',
  ٱ: 'a',
});

/** Harakat and other combining marks, which carry no information in a URL. */
const ARABIC_DIACRITICS = /[ً-ْٓ-ٰٟ]/g;

const ARABIC_CHAR = /[ء-ي]/;

export function containsArabicChar(value: string): boolean {
  return ARABIC_CHAR.test(value);
}

/** Transliterate Arabic to Latin. Non-Arabic characters pass through untouched. */
export function transliterateArabic(input: string): string {
  let output = '';
  for (const char of input.replace(ARABIC_DIACRITICS, '')) {
    const mapped = ARABIC_LETTERS[char];
    output += mapped === undefined ? char : mapped;
  }
  return output;
}

const THAANA_CHAR = /[ހ-޿]/;

/**
 * Transliterate a Thaana string to Latin. Non-Thaana characters pass through so a
 * mixed headline ("iOS 26 ގައި ބަދަލުތައް") survives intact.
 */
export function transliterateThaana(input: string): string {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) continue;

    const consonant = THAANA_CONSONANTS[char];
    if (consonant !== undefined) {
      const next = input[index + 1];
      const fili = next === undefined ? undefined : THAANA_FILI[next];
      if (fili !== undefined) {
        output += consonant + fili;
        index += 1; // the fili is consumed with its consonant
      } else {
        // A consonant with no fili at all (rare, and technically malformed Thaana):
        // emit it bare rather than guessing a vowel.
        output += consonant;
      }
      continue;
    }

    // A stray fili with no consonant before it — emit its vowel so nothing is lost.
    const orphanFili = THAANA_FILI[char];
    if (orphanFili !== undefined) {
      output += orphanFili;
      continue;
    }

    output += char;
  }
  return output;
}

export function containsThaanaChar(value: string): boolean {
  return THAANA_CHAR.test(value);
}

/**
 * Build a URL slug. Thaana is transliterated, Latin accents are folded, everything
 * else is lowercased and hyphenated. Always returns a non-empty string: a title made
 * entirely of characters we cannot romanise falls back to `fallback`.
 */
export function slugify(input: string, fallback = 'untitled'): string {
  if (typeof input !== 'string') return fallback;

  let value = input.normalize('NFC');
  if (containsThaanaChar(value)) value = transliterateThaana(value);
  if (containsArabicChar(value)) value = transliterateArabic(value);

  value = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  value = value.toLowerCase();
  for (const [pattern, replacement] of LATIN_FOLDING) {
    value = value.replace(pattern, replacement);
  }

  value = value
    .replace(/['’‘`"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return value === '' ? fallback : value;
}

/**
 * Slug that does not collide with anything already taken.
 * Appends `-2`, `-3`, … rather than a hash, because an editor has to read these.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(desired);
  if (!used.has(base)) return base;
  let counter = 2;
  while (used.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

/** A slug is valid when it is lowercase, hyphen-separated and URL-safe as written. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
