#!/usr/bin/env node
// Prints the WCAG contrast of every CONTRAST_PAIRS entry per colour scheme and exits 1 on any failure
// (E-1.4 §1.2: `pnpm --filter @codelex/design-system contrast`). Reads the built package: run `build` first.
import { COLOR_SCHEMES, CONTRAST_PAIRS, contrastRatio, getTokens } from '../dist/index.js';

let failures = 0;
for (const scheme of COLOR_SCHEMES) {
  const { color } = getTokens(scheme);
  for (const { foreground, background, min } of CONTRAST_PAIRS) {
    const ratio = contrastRatio(color[foreground], color[background]);
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} ${foreground} on ${background}: ${ratio.toFixed(2)} (min ${min})`,
    );
  }
}
process.exitCode = failures === 0 ? 0 : 1;
