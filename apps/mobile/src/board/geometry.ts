/**
 * Board camera geometry (E-1.4 §2.3). Pure worklets: they run on the UI thread inside gesture callbacks (P5 §4.2:
 * no JS-thread work per pointer frame) and on the JS thread in tests.
 *
 * Camera model: the board content (`size` × `size` dp) is drawn with `translate(t) · scale(zoom)` around the
 * viewport centre `o`, so a content point `c` shows at `v = o + t + zoom · (c − o)`.
 */

/** Classic 15 × 15 (R-BOARD-001); the renderer supports no other size in v1. */
export const BOARD_SIZE = 15;

/** Zoom at which the board counts as "Focus": glyph sizes switch and double-tap zooms out (E-1.4 §2.4). */
export const FOCUS_THRESHOLD = 1.6;

/** Viewport point → content point. */
export function toContent(
  vx: number,
  vy: number,
  size: number,
  zoom: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  'worklet';
  const o = size / 2;
  return { x: o + (vx - o - tx) / zoom, y: o + (vy - o - ty) / zoom };
}

/** The square under a viewport point, or null outside the board. Never rounds to device pixels. */
export function hitTest(
  vx: number,
  vy: number,
  size: number,
  zoom: number,
  tx: number,
  ty: number,
): { row: number; col: number } | null {
  'worklet';
  const { x, y } = toContent(vx, vy, size, zoom, tx, ty);
  const cell = size / BOARD_SIZE;
  const col = Math.floor(x / cell);
  const row = Math.floor(y / cell);
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  return { row, col };
}

/** One translation axis clamped so the zoomed board always covers the viewport. */
export function clampTranslation(t: number, size: number, zoom: number): number {
  'worklet';
  const max = ((zoom - 1) * size) / 2;
  return Math.min(max, Math.max(-max, t));
}

/** Translation (one axis) that centres square index `index` at `zoom`, clamped to the board. */
export function focusTranslation(index: number, size: number, zoom: number): number {
  'worklet';
  const o = size / 2;
  const centre = ((index + 0.5) * size) / BOARD_SIZE;
  return clampTranslation(-(centre - o) * zoom, size, zoom);
}
