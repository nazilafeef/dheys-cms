/**
 * Colour contrast, per WCAG 2.2.
 *
 * Used by the theme test to prove every shipped pairing clears AA, and by the admin to
 * warn an editor before they publish an unreadable pull-quote. Small enough to own
 * outright rather than take a dependency for.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha is ignored — contrast needs a solid). */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');
  const expand = (part: string): number => Number.parseInt(part.repeat(2), 16);

  if (value.length === 3) {
    return {
      r: expand(value[0] ?? '0'),
      g: expand(value[1] ?? '0'),
      b: expand(value[2] ?? '0'),
    };
  }
  if (value.length === 6 || value.length === 8) {
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    };
  }
  throw new Error(`"${hex}" is not a hex colour this can read.`);
}

function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

/** Relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(colour: string | Rgb): number {
  const { r, g, b } = typeof colour === 'string' ? parseHex(colour) : colour;
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Contrast ratio between two colours, from 1 to 21. Order does not matter. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export type TextSize = 'normal' | 'large';

/** AA: 4.5:1 for normal text, 3:1 for large text and non-text UI. */
export function meetsAA(
  foreground: string,
  background: string,
  size: TextSize = 'normal',
): boolean {
  const required = size === 'large' ? 3 : 4.5;
  return contrastRatio(foreground, background) >= required;
}

/** AAA: 7:1 normal, 4.5:1 large. Not a shipping requirement, reported for information. */
export function meetsAAA(
  foreground: string,
  background: string,
  size: TextSize = 'normal',
): boolean {
  const required = size === 'large' ? 4.5 : 7;
  return contrastRatio(foreground, background) >= required;
}

/** Rounded to one decimal, which is how contrast is conventionally quoted. */
export function ratioLabel(a: string, b: string): string {
  return `${contrastRatio(a, b).toFixed(2)}:1`;
}
