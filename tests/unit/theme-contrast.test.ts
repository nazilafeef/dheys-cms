import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio, meetsAA, parseHex, relativeLuminance } from '@lib/contrast';

/**
 * The accessibility proof for both shipped themes.
 *
 * This parses the real `tokens.css` files rather than a copy of their values, so an
 * operator who rebrands by editing one file gets told immediately if they have broken a
 * pairing. That is the whole point of the exercise: a contrast claim in a comment is a
 * hope, a contrast claim a test reads out of the stylesheet is a fact.
 *
 * `--ink-400` is deliberately excluded from the 4.5:1 set. It is not a text colour; it is
 * for hairlines and disabled affordances, where 3:1 applies. Both token files say so.
 */

type Tokens = Record<string, string>;

function readTheme(theme: 'bare' | 'dheys'): { light: Tokens; dark: Tokens } {
  const path = fileURLToPath(new URL(`../../themes/${theme}/tokens.css`, import.meta.url));
  const css = readFileSync(path, 'utf8');

  const light = extractBlock(css, `:root[data-theme-name='${theme}'] {`);
  // The explicit `[data-theme='dark']` block is the authority for the dark scheme: it is
  // what the toggle sets, and it must carry every token the media query does.
  const dark = {
    ...light,
    ...extractBlock(css, `:root[data-theme-name='${theme}'][data-theme='dark'] {`),
  };

  return { light, dark };
}

/** Pull `--name: value;` pairs out of one brace-delimited block. */
function extractBlock(css: string, opener: string): Tokens {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`Could not find block "${opener}" — did the selector change?`);
  const bodyStart = start + opener.length;
  const end = css.indexOf('\n}', bodyStart);
  const body = css.slice(bodyStart, end);

  const tokens: Tokens = {};
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

/** Colour pairings that carry text and must therefore clear 4.5:1. */
const TEXT_PAIRINGS: ReadonlyArray<readonly [string, string]> = [
  ['ink-900', 'paper'],
  ['ink-600', 'paper'],
  ['ink-500', 'paper'],
  ['ink-900', 'surface'],
  ['ink-600', 'surface'],
  ['ink-500', 'surface'],
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent-hover', 'paper'],
  ['danger', 'paper'],
  ['warning', 'paper'],
  ['success', 'paper'],
];

const THEMES = ['bare', 'dheys'] as const;
const SCHEMES = ['light', 'dark'] as const;

describe.each(THEMES)('%s theme', (theme) => {
  const tokens = readTheme(theme);

  describe.each(SCHEMES)('%s scheme', (scheme) => {
    const palette = tokens[scheme];

    it('defines every colour token the components read', () => {
      for (const name of [
        'ink-900',
        'ink-600',
        'ink-500',
        'ink-400',
        'paper',
        'surface',
        'rule',
        'accent',
        'accent-hover',
        'accent-contrast',
        'focus',
        'danger',
        'warning',
        'success',
      ]) {
        expect(palette[name], `${theme}/${scheme} is missing --${name}`).toBeDefined();
      }
    });

    it.each(TEXT_PAIRINGS)('--%s on --%s clears WCAG AA (4.5:1)', (fg, bg) => {
      const foreground = palette[fg];
      const background = palette[bg];
      expect(foreground).toBeDefined();
      expect(background).toBeDefined();
      const ratio = contrastRatio(foreground ?? '#000', background ?? '#fff');
      expect(
        ratio,
        `${theme}/${scheme}: --${fg} (${foreground}) on --${bg} (${background}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('text on an accent fill clears AA', () => {
      const ratio = contrastRatio(palette['accent-contrast'] ?? '', palette['accent'] ?? '');
      expect(ratio, `${theme}/${scheme}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it('the focus ring clears 3:1 against both grounds', () => {
      for (const ground of ['paper', 'surface'] as const) {
        const ratio = contrastRatio(palette['focus'] ?? '', palette[ground] ?? '');
        expect(
          ratio,
          `${theme}/${scheme}: focus on ${ground} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it('the focus ring is never the accent colour', () => {
      // A focus ring that matches the link colour is invisible exactly when it matters.
      expect(palette['focus']).not.toBe(palette['accent']);
      expect(palette['focus']).not.toBe(palette['accent-hover']);
    });

    it('--ink-400 is usable for non-text at 3:1, and is not claimed as a text colour', () => {
      const ratio = contrastRatio(palette['ink-400'] ?? '', palette['paper'] ?? '');
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(meetsAA(palette['ink-400'] ?? '', palette['paper'] ?? '')).toBe(false);
    });

    it('hairlines are visible against their ground', () => {
      const ratio = contrastRatio(palette['rule'] ?? '', palette['paper'] ?? '');
      expect(ratio).toBeGreaterThan(1.1);
    });
  });

  it('inverts to a warm, non-pure-black ground in the dark scheme', () => {
    const darkPaper = tokens.dark['paper'] ?? '';
    expect(darkPaper.toLowerCase()).not.toBe('#000000');
    expect(darkPaper.toLowerCase()).not.toBe('#000');
    // Dark, but not black: some light gets through.
    const luminance = relativeLuminance(darkPaper);
    expect(luminance).toBeGreaterThan(0);
    expect(luminance).toBeLessThan(0.05);
  });

  it('actually changes ground between schemes', () => {
    expect(tokens.light['paper']).not.toBe(tokens.dark['paper']);
  });
});

describe('the Dheys palette matches its published specification', () => {
  // These are the values in docs/BUILD-BRIEF.md section 9 and docs/THEME-PROVENANCE.md.
  // If someone edits the theme, this says so rather than letting the docs quietly rot.
  const { light } = readTheme('dheys');

  it.each([
    ['ink-900', '#14120e'],
    ['ink-600', '#4a463d'],
    ['ink-400', '#7c7668'],
    ['paper', '#fbfaf6'],
    ['surface', '#f3f1ea'],
    ['rule', '#dfdbd0'],
    ['accent', '#1f4d46'],
    ['accent-hover', '#163a34'],
    ['focus', '#b4531f'],
  ])('--%s is %s', (name, expected) => {
    expect(light[name]?.toLowerCase()).toBe(expected);
  });

  it('caps the measure at 68 characters for Latin and 62 for Thaana', () => {
    expect(light['measure-latin']).toBe('68ch');
    expect(light['measure-thaana']).toBe('62ch');
  });

  it('uses a 2px radius and nothing else — a formal-document aesthetic', () => {
    expect(light['radius']).toBe('2px');
  });
});

describe('contrast maths', () => {
  it('agrees with the reference values at the extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#1f4d46', '#fbfaf6')).toBeCloseTo(
      contrastRatio('#fbfaf6', '#1f4d46'),
      10,
    );
  });

  it('reads three- and six-digit hex the same way', () => {
    expect(parseHex('#fff')).toEqual(parseHex('#ffffff'));
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('ignores an alpha channel rather than refusing the colour', () => {
    expect(parseHex('#12345678')).toEqual(parseHex('#123456'));
  });

  it('refuses something that is not a colour', () => {
    expect(() => parseHex('rebeccapurple')).toThrow(/not a hex colour/);
  });
});
