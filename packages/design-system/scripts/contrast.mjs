#!/usr/bin/env node
// Prints the WCAG contrast of every CONTRAST_PAIRS entry per colour scheme and exits 1 on any failure
// (E-1.4 §1.2: `pnpm --filter @codelex/design-system contrast`). Reads the built package: run `build` first.
import {
  BOARD_CONTRAST_PAIRS,
  COLOR_SCHEMES,
  CONTRAST_PAIRS,
  contrastRatio,
  getTokens,
} from '../dist/index.js';

let failures = 0;
for (const scheme of COLOR_SCHEMES) {
  const { color, board } = getTokens(scheme);
  const pairs = [
    ...CONTRAST_PAIRS.map((p) => ({ ...p, fg: color[p.foreground], bg: color[p.background] })),
    ...BOARD_CONTRAST_PAIRS.map((p) => ({
      ...p,
      fg: board[p.foreground],
      bg: board[p.background],
    })),
  ];
  for (const { foreground, background, min, fg, bg } of pairs) {
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} ${foreground} on ${background}: ${ratio.toFixed(2)} (min ${min})`,
    );
  }
}
process.exitCode = failures === 0 ? 0 : 1;
