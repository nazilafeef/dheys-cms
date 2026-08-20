# Theming

Two themes ship. **Bare** is the neutral default for a fresh install. **Dheys** is this
project's branded theme.

```bash
PUBLIC_THEME=dheys pnpm build     # branded
pnpm build                        # bare, the default
```

Both are compiled in and selected by a `data-theme-name` attribute on `<html>`, so an
operator can switch without a rebuild if they want to.

## Rebranding

Edit one file: `themes/bare/tokens.css` (or copy it to `themes/yours/tokens.css`). Every
colour, size and space in the product resolves through those custom properties, and no
component contains a colour literal.

```css
:root[data-theme-name='bare'] {
  --ink-900: #1a1a1a; /* body text        */
  --ink-600: #444444; /* secondary text   */
  --ink-500: #666666; /* meta, captions   */
  --ink-400: #8a8a8a; /* NON-TEXT only    */
  --paper: #ffffff;
  --surface: #f5f5f5;
  --rule: #e0e0e0;
  --accent: #22558c;
  --accent-hover: #1a4270;
  --accent-contrast: #ffffff;
  --focus: #a3450f;
}
```

Then the dark scheme, twice — once under `@media (prefers-color-scheme: dark)` guarded with
`:not([data-theme='light'])`, and once under `[data-theme='dark']` so the toggle wins in
both directions.

## Two rules the tests enforce

**Every text pairing clears 4.5:1, in both schemes.**
`tests/unit/theme-contrast.test.ts` parses your `tokens.css` and checks it. Change a token
and the test tells you what you broke, with the measured ratio.

**The focus ring is never the accent.** A focus ring that matches the link colour is
invisible exactly when it matters — on a focused link. The test asserts they differ.

`--ink-400` is deliberately excluded from the 4.5:1 set and asserted _not_ to pass it: it is
for hairlines and disabled affordances, where 3:1 applies. If you promote it to a text
colour, the test fails on purpose.

## Type and space

```css
--size-base: 1rem; /* scale of 1.2 in bare, 1.25 from 17px in dheys */
--space-4: 1rem; /* 4px steps throughout */
--radius: 4px; /* dheys uses 2px — a formal-document aesthetic */
--measure-latin: 68ch;
--measure-thaana: 62ch; /* Thaana is wider and carries marks off the baseline */
```

## Fonts

Bare uses a system stack, so a fresh install ships no font binary and makes no webfont
request.

Dheys declares a Thaana font _slot_ rather than a font. See [FONTS.md](./FONTS.md) — the
licensing position is unresolved and stated plainly, and `pnpm link-font` wires up a licensed
copy you hold without committing anything.

## Components

Components are plain `.astro` files under `src/components/` with scoped styles. To restyle
one, edit its `<style>` block; to replace one, change the import. There is no theme registry
and no slot system to learn — a component is a file.

## Dark mode with no flash

A `200`-byte inline script in `<head>` reads the stored preference and sets `data-theme`
before first paint. It has to be blocking and inline: deferring it means the page paints in
one scheme and repaints in the other, which is the flash every reader in a dark room notices.
It is the only render-blocking script on the site.

The toggle cycles light → dark → follow the system. The third state matters: once someone has
clicked, "follow my OS" should still be reachable without clearing site data.

## Ad slots

```astro
<AdSlot name="article-end" />
<!-- inert: renders and requests nothing -->
<AdSlot name="article-end" creative={html} height={250} />
```

An unfilled slot makes **no network request of any kind** — no script, no iframe, no pixel,
no preconnect. Most CMS ad slots load the network's tag unconditionally and let it decide
whether to paint; on a page with no ad sold that costs the reader a third-party connection
and a Lighthouse penalty in exchange for nothing. A filled slot reserves its height up
front, because unreserved ad space is the largest source of layout shift on most editorial
sites.
