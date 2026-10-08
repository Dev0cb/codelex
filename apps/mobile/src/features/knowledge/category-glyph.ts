/**
 * Text glyphs for the category registry icons (E-1.5 §7.1) until the E-1.4 §4 `Icon` set exists. Decorative only:
 * the category name is always shown next to the glyph and read by screen readers, so the glyph and its hue are
 * never the only cue (§9.4). BMP geometric symbols with text presentation (no colour emoji); U+FE0E forces text
 * presentation where a code point has an emoji variant.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  code: '</>',
  'cpu-chip': '▦',
  network: '⇄',
  cloud: '☁︎',
  infinity: '∞',
  database: '▤',
  sparkles: '✦',
  shield: '◈',
  memory: '▥',
};

/** Fallback for an icon name the registry adds before this table does. */
const DEFAULT_GLYPH = '•';

export function categoryGlyph(icon: string | undefined): string {
  return (icon === undefined ? undefined : GLYPHS[icon]) ?? DEFAULT_GLYPH;
}
