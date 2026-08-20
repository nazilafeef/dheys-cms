# i18n and right-to-left

Three locales ship: **English** (`en`, Latin, LTR), **Dhivehi** (`dv`, Thaana, RTL) and
**Arabic** (`ar`, Arabic, RTL).

Two of them are right-to-left on purpose. A single RTL locale lets script-specific bugs
hide; two in different scripts flush them out.

## Routing

The default locale has no prefix; every other locale gets one.

```
/                          en
/dv                        dv
/ar/articles/some-slug     ar
```

One template serves every locale — the route files use a rest parameter (`[...locale]`) that
is `undefined` for the default. Near-identical per-language pages drift apart within a week.

Every URL is built through `src/lib/routes.ts`. Nothing else joins a locale or a base path.

## Translations have their own slugs

This is the part that catches people. The Arabic version of "The tide gauge at the old
harbour" lives at `mikyas-almad-fi-almina-alqadim`, not at the English slug with a prefix.

Translations are linked by `translationOf` pointing at the original's slug, and the language
switcher and `hreflang` take real per-locale URLs. Deriving them by prefixing the current
path is only correct when every language shares a slug, and for articles it never is.

```yaml
title: مقياس المد في الميناء القديم
slug: mikyas-almad-fi-almina-alqadim
locale: ar
translationOf: the-tide-gauge-at-the-old-harbour
```

`pnpm check:links` catches this class of mistake: it resolves every internal link against
the files actually built.

## Slugs

Thaana and Arabic are **transliterated**, not stripped and not percent-encoded.

```
ބަނދަރުގެ ދިޔަވަރު މާޕު  →  bandharuge-dhiyavaru-maapu
آمنة رشيد                →  aamnh-rshyd
```

A naive slugger strips every non-Latin character, so a Dhivehi headline yields the empty
string and falls back to a constant — then two such headlines collide on one URL and a route
silently disappears. That happened during this build with two Arabic bylines, both of which
became `untitled`.

Thaana transliteration reads a consonant together with its _fili_ (vowel mark), which is what
makes the output pronounceable rather than a run of bare consonants.

## Punctuation

Dhivehi uses Arabic-script punctuation, and this is enforced:

| Use        | Not |
| ---------- | --- |
| `،` U+060C | `,` |
| `؛` U+061B | `;` |
| `؟` U+061F | `?` |

A Latin comma inside a Thaana run renders with the wrong directional class and visibly breaks
the line. It is a correctness problem, not a style preference, so a guardrail blocks
publication over it, the editor warns while you are still typing, and the system prompt tells
agents about it explicitly.

## Combining marks

Thaana _fili_ and Arabic _harakat_ are Unicode **marks** (`\p{M}`), not letters (`\p{L}`).
Any pattern written as `[\p{L}\p{N}]` silently deletes every vowel in a Dhivehi word.

This produced two real bugs during the build:

- **Heading anchors.** The table of contents stripped the fili while the Markdown pipeline
  kept them, so every Dhivehi anchor pointed at nothing.
- **Word counts.** `ދިވެހި ބަސް` counted as five words instead of two, so a minimum-words
  guardrail overcounted Dhivehi by about 2.5x and reading times were equally wrong.

If you write a regex over text, include `\p{M}`.

## CSS

**Logical properties throughout.** `margin-inline-start`, never `margin-left`.
`padding-block`, `border-inline-start`, `inset-inline-end`, `text-align: start`. One
`margin-left` puts a gutter on the wrong side of every RTL page.

**Measure differs by script.** 68 characters for Latin, 62 for Thaana — its glyphs are wider
and carry marks above and below the baseline, so the same character count reads denser.

**Icons mirror selectively.** `.icon-directional` flips in RTL. A back-arrow flipped is
correct; a clock face flipped is nonsense, so it is opt-in per icon.

**No synthesised italic for Thaana.** Browsers shear the glyphs, distorting the fili.
Emphasis is carried by weight.

## Strings

Every UI string lives in `src/locales/{en,dv,ar}.json`. No component contains English.

```ts
const t = translator(locale);
t('article.readingTime', { minutes: 4 });
```

A missing key falls back to English, then to the key itself — so a gap is diagnosable rather
than rendering `undefined`. A test asserts every locale defines every key English does, which
is what stops a half-translated interface shipping unnoticed.

## Reading time

Thaana and Arabic are read more slowly than Latin by most readers: 160 words per minute
against 220. Counting them at an English rate produces a figure that is confidently wrong.

## Search

Pagefind indexes all three languages, including Thaana. It does **not** stem Dhivehi —
search works and matches whole words, but not across root forms. That is a Pagefind
limitation, noted here rather than discovered later.

## Adding a locale

1. Add it to `LOCALES` in `src/lib/i18n.ts` with its direction, script, measure and Intl tag.
2. Create `src/locales/<code>.json` with every key. The completeness test will list what is
   missing.
3. If it is a new script, extend `slugify` with a transliteration table.
4. Add content under `src/content/posts/<code>/`.

Routing, `hreflang`, feeds, the sitemap and the switcher pick it up with no further changes.
