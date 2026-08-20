# Theme provenance

This file exists so that nobody later has to wonder where the Dheys palette came from.

## The tokens are this project's own specification

The colour values, type scale, spacing steps and measure limits in `themes/dheys/tokens.css`
were specified for this project. They were **not** sampled from another site's stylesheet,
extracted from a design file belonging to somebody else, or copied from a theme.

They were written down as a specification first — deep ink on warm paper, one accent used
sparingly, no gradients, a single elevation step, a 2px radius throughout — and the CSS was
written to match it.

## The palette

```
--ink-900: #14120E        body text, headings
--ink-600: #4A463D        secondary text
--ink-500: #6B6558        meta, captions
--ink-400: #7C7668        NON-TEXT: hairlines, disabled
--paper:   #FBFAF6        page background, warm off-white
--surface: #F3F1EA        cards, wells
--rule:    #DFDBD0        hairlines, borders
--accent:  #1F4D46        deep muted green; links, active states
--accent-hover: #163A34
--focus:   #B4531F        focus ring; never the accent
```

Dark mode inverts to a warm near-black ground — never pure black — keeping the same accent
hue at raised lightness.

### One addition to the original specification

`--ink-500` (#6B6558) is not in the original list. It was added because `--ink-400`, which
the specification assigns to "meta, captions", measures **4.34:1** against `--paper` — just
under the 4.5:1 that WCAG AA requires for normal text.

Two requirements were in conflict: the specified palette, and "every pairing clears 4.5:1".
Rather than silently alter a specified value or silently ship failing contrast, `--ink-400`
was kept exactly as specified and reclassified as a **non-text** colour — hairlines and
disabled affordances, where 3:1 applies — and `--ink-500` was added at 5.56:1 for the text
that `--ink-400` was going to carry.

The contrast test asserts both: that the text colours clear 4.5:1, and that `--ink-400`
specifically does _not_, so nobody quietly promotes it back to a text colour.

## It is checked, not claimed

`tests/unit/theme-contrast.test.ts` parses the real `tokens.css` files and verifies:

- every text pairing clears 4.5:1, in **both** themes and **both** colour schemes
- text on an accent fill clears 4.5:1
- the focus ring clears 3:1 and is never equal to the accent
- the dark ground is neither pure black nor the light ground
- the Dheys palette still matches the specification above, value for value

92 assertions. Change a token and the test tells you what you broke.

## The other theme

`themes/bare/tokens.css` is the default for a fresh install: neutral, unbranded, and
deliberately anonymous, on a system font stack so a fresh install ships no font binary and
makes no webfont request. Same token names, so a component never knows which theme it is in.

## The logo

`src/assets/brand/dheys-logo.svg` is the operator's artwork, supplied to this project. It is
not a mark this build designed. If the file is absent the theme renders a text wordmark and
the build warns, naming that exact path — no substitute logo is ever drawn, because a
generated mark that looks deliberate is worse than an obvious placeholder nobody replaces.

## The font

No font binary ships, and none should be added without reading [FONTS.md](./FONTS.md). The
licensing position there is genuinely unresolved, and that document says so plainly rather
than working around it.
