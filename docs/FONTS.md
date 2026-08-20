# Fonts and licensing

## The short version

**This repository ships no font binary, and it should not start.**

The Thaana typeface intended for this project cannot be redistributed here on any basis
anyone has been able to establish. That is a licensing question, not a technical one, and
it is unresolved — not merely unaddressed. What ships instead is a _slot_: a documented
contract you can drop your own licensed files into, plus `pnpm link-font` to wire a local
install up without committing anything.

## Why there is no font here

Two separate problems, either of which alone would be enough:

**The base face carries a bare all-rights-reserved notice with no EULA.** There is a
copyright line and nothing else — no grant, no terms, no stated permissions. An
all-rights-reserved notice with no accompanying licence does not grant redistribution; it
withholds it. "No terms" is not "any terms".

**One build variant merges an OFL-licensed face.** The SIL Open Font License is a copyleft
licence for fonts, and clause 5 is explicit: a font derived from or merged with an
OFL-licensed font must itself be distributed under the OFL, in full, and may not be sold on
its own. If that merge happened, the resulting file is either OFL-licensed in its entirety
or it is not distributable at all. Which of those is true depends on facts about the merge
that are not documented anywhere I could find.

Those two combine badly. The all-rights-reserved half says "you may not redistribute"; the
OFL half says "if you redistribute, it must be under the OFL". A file cannot be both.

## What is actually unknown

Stated plainly, because papering over this would be worse than the gap:

- **Who holds copyright in the base face**, and whether they intended any grant at all.
- **Whether the OFL merge happened in the variant that matters**, or only in a build that
  is not the one anyone ships.
- **Whether the derivative work has an independent claim** — some Thaana faces descend from
  metal or photo-typesetting designs old enough to be out of copyright in some
  jurisdictions and not others. That is a question for a lawyer with the actual provenance
  in front of them, not for a build script.

None of these has been resolved. Until one of them is, shipping the binary would be
distributing a file this project has no established right to distribute — which is exactly
the kind of thing an MIT-licensed repository must not do to the people who fork it.

## What ships instead

### The font slot

`themes/dheys/fonts.css` declares an `@font-face` whose `src` is a single CSS variable:

```css
:root {
  --thaana-font-url: url('/fonts/your-licensed-face.woff2');
}
```

Set it and the face loads. Leave it unset and the theme falls through to whatever Thaana
faces the reader's system provides. Nothing is ever fetched from a third-party CDN — a CMS
that loads a font from someone else's server has quietly added a tracking vector and a hard
runtime dependency to every page.

### The metric contract

A Thaana face substituted carelessly does not merely look wrong, it _renders_ wrong. The
slot handles four things, and any replacement must keep them:

**`unicode-range` must include U+0020 and U+00A0.** This is the one that catches everyone.
Thaana is a right-to-left script interleaved with ordinary spaces. If the letters come from
the Thaana face and the space glyph comes from the Latin fallback, word spacing changes
mid-line and the run visibly comes apart. The shipped range covers the Thaana block, the
two space characters, and the Arabic-script punctuation Dhivehi uses.

**`font-synthesis: none`.** Thaana has no true italic. Browsers synthesise one by shearing
the glyphs, which distorts the _fili_ — the vowel marks sitting above and below the
baseline — into something between illegible and wrong. Synthesised bold thickens them into
each other. The theme carries emphasis with weight instead.

**Letter and word spacing are inherited, never overridden.** The face's metrics are designed
around marks that sit outside the em box. Tightening the tracking to match a Latin rhythm
collides them.

**`font-display: swap`, and preload in the head.** Thaana has essentially no system fallback
on most platforms, so a blocking font load means a blank article rather than a
differently-styled one.

### Linking a local install

```bash
pnpm link-font --from "C:/fonts/your-licensed-face"
pnpm link-font --clear     # unlink, and delete what was copied
```

It copies the `.woff2` into `src/assets/fonts/` and writes `font-path.local.json`. **Both
are gitignored**, deliberately: neither the binary nor the path to your licensed copy
belongs in a public repository. The script prints the two lines to add to your theme.

## If you have a licence

Then this is easy. Convert to `.woff2`, run `pnpm link-font`, set `--thaana-font-url`, add
the preload tag it prints, and you are done. The slot exists precisely so that having a
licence is the only hard part.

## If you are choosing a font

Prefer an OFL-licensed Thaana face and comply with the OFL — it is a straightforward
licence, it permits everything a website needs, and it removes this entire question. If you
adopt one, you can commit it, and this document becomes a note about why the slot exists
rather than a constraint you have to work around.

## Fallbacks

`--font-thaana-fallback` names system faces in the order they are worth trying:
`MV Faseyha`, `MV Boli`, `A_Faruma`, `Faruma`, `MV Iyyu Nala`. These are present on many
Maldivian installs and on essentially no others, which is exactly why the slot exists.

No permissively-licensed Thaana face is bundled as a fallback. Finding one whose provenance
is genuinely clean is the same problem as above, and shipping a face with an unexamined
licence as the _fallback_ would be the same mistake made somewhere less visible.

## Related

- `themes/dheys/fonts.css` — the slot and the metric contract, commented in full
- `scripts/link-font.mjs` — the linking script
- [i18n-and-rtl.md](./i18n-and-rtl.md) — how Thaana is handled everywhere else
- `release/OWNER-TODO.md` item 4 — this, as a task
