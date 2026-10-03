import type { ColorRole, ColorScheme, HexColor, Tokens } from './tokens.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): value is HexColor {
  return HEX.test(value);
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque `#RRGGBB` colour. */
export function relativeLuminance(color: HexColor): number {
  if (!HEX.test(color)) throw new Error('not a #RRGGBB colour');
  return 0.2126 * channel(color, 1) + 0.7152 * channel(color, 3) + 0.0722 * channel(color, 5);
}

/** WCAG 2.x contrast ratio, from 1 (same colour) to 21 (black on white). */
export function contrastRatio(a: HexColor, b: HexColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text needs 4.5:1, UI shapes 3:1 (WCAG 2.2 AA; E-1.4 §1.2). */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export interface ContrastPair {
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  readonly min: number;
}

/** Pairs that must stay legible in every scheme. Extended with the spec's board and tile pairs in S1. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...(['bgBase', 'bgSurface', 'bgRaised'] as const).flatMap((background) => [
    { foreground: 'textPrimary' as const, background, min: MIN_TEXT_CONTRAST },
    { foreground: 'textMuted' as const, background, min: MIN_TEXT_CONTRAST },
    { foreground: 'feedbackError' as const, background, min: MIN_TEXT_CONTRAST },
    { foreground: 'feedbackWarning' as const, background, min: MIN_TEXT_CONTRAST },
    { foreground: 'feedbackInfo' as const, background, min: MIN_TEXT_CONTRAST },
    { foreground: 'accentPrimary' as const, background, min: MIN_UI_CONTRAST },
  ]),
  // `borderSubtle` is not listed: a decorative 1 dp separator (WCAG 1.4.11 does not apply); it never carries
  // state, which uses `accentPrimary` (E-1.4 §1.2, §4).
  { foreground: 'accentOnPrimary', background: 'accentPrimary', min: MIN_TEXT_CONTRAST },
];

export interface ContrastFailure extends ContrastPair {
  readonly scheme: ColorScheme;
  readonly ratio: number;
}

/** Every pair of `CONTRAST_PAIRS` below its minimum in the given tokens (empty = compliant). */
export function contrastFailures(tokens: Tokens): ContrastFailure[] {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const ratio = contrastRatio(tokens.color[pair.foreground], tokens.color[pair.background]);
    return ratio < pair.min ? [{ ...pair, scheme: tokens.scheme, ratio }] : [];
  });
}
