// Size gate of the `.clxi` artefact and the pre-agreed f0 switch rule (lexicon-index note §5, sprint 3 task P7).
// One source for the numbers: `src/index/clxi/clxi.test.ts` applies them to the real artefacts (hard gate),
// `bench:index` reports them, and `maxBytes` must equal `lexiconBytes` in apps/mobile/bundle-budget.json
// (checked by test/size-gate.test.mjs), which `prepare:lexicon` enforces on the bundled file.
// Zero dependencies.

/**
 * Hard gates (measured basis in lexicon-index note §5.1):
 * - `maxBytes`: absolute cap on the bundled artefact, any form count, both variants (= mobile `lexiconBytes`).
 * - `maxBytesPerFormWithGaddag`: f1 density. 189 B/form today; real-plus-synthetic corpora measure 194–206 B/form
 *   from 2,000 to 3,000 forms (4 seeds), pure synthetic 214–240. Catches builder or content drift before the cap.
 * - `maxBytesPerFormWithoutGaddag`: f0 density (67 B/form today, 68–79 on the scale corpora).
 * - `maxFormsWithGaddag`: batch-3 ceiling = ⌊maxBytes / maxBytesPerFormWithGaddag / 50⌋ × 50. Above it the f1
 *   variant is no longer planned to fit: the f0 switch rule below decides, not a raised cap.
 * - `maxGaddagToDawg`: GADDAG sections ≤ 6 × DAWG sections (sprint 2 decision log; measured 4.4–4.7×).
 */
export const SIZE_GATE = Object.freeze({
  maxBytes: 550_000,
  maxBytesPerFormWithGaddag: 215,
  maxBytesPerFormWithoutGaddag: 128,
  maxFormsWithGaddag: 2_550,
  maxGaddagToDawg: 6,
});

/**
 * Pre-agreed switch of the bundled variant to f0 (no GADDAG; bots use the DAWG fallback): allowed without a new
 * review when f1 fails the gate, f0 passes, and DAWG-path generation time is at most 1.5× the GADDAG path's
 * (bots `qa2` bench, p95 per-position time on mid-game positions, measured 1.43–1.45×).
 */
export const F0_SWITCH = Object.freeze({ maxGenerationTimeRatio: 1.5 });

const isCount = (n) => Number.isInteger(n) && n >= 0;

/**
 * Gate failures of one artefact (empty array = pass). `dawgBytes`/`gaddagBytes` (section bytes) are required
 * with the GADDAG.
 * @param {{ bytes: number, forms: number, gaddag: boolean, dawgBytes?: number, gaddagBytes?: number }} m
 * @returns {string[]}
 */
export function sizeGateFailures({ bytes, forms, gaddag, dawgBytes, gaddagBytes }) {
  if (!isCount(bytes) || !isCount(forms) || forms === 0)
    throw new RangeError('sizeGateFailures: bytes and forms must be integers, forms > 0');
  if (gaddag && (!isCount(dawgBytes) || !isCount(gaddagBytes) || dawgBytes === 0))
    throw new RangeError(
      'sizeGateFailures: dawgBytes and gaddagBytes are required with the GADDAG',
    );
  const g = SIZE_GATE;
  const variant = gaddag ? 'f1' : 'f0';
  const out = [];
  if (bytes > g.maxBytes) out.push(`${variant}: ${bytes} B > ${g.maxBytes} B (lexiconBytes cap)`);
  const perForm = gaddag ? g.maxBytesPerFormWithGaddag : g.maxBytesPerFormWithoutGaddag;
  if (bytes > perForm * forms)
    out.push(`${variant}: ${(bytes / forms).toFixed(1)} B/form > ${perForm} B/form`);
  if (gaddag) {
    if (forms > g.maxFormsWithGaddag)
      out.push(`f1: ${forms} forms > ${g.maxFormsWithGaddag} (batch-3 ceiling)`);
    if (gaddagBytes > g.maxGaddagToDawg * dawgBytes)
      out.push(`f1: GADDAG ${gaddagBytes} B > ${g.maxGaddagToDawg} x DAWG ${dawgBytes} B`);
  }
  return out;
}

/**
 * The f0 switch rule as a function: which variant the app bundles.
 * - `keep-f1` (flags 1): f1 passes the gate.
 * - `switch-f0` (flags 0): f1 fails, f0 passes and `generationTimeRatio` (DAWG ÷ GADDAG time) ≤ 1.5.
 * - `escalate` (no flags): anything else; lexicon-engineer, mobile-engineer and ai-engineer decide (CDN delivery,
 *   a reviewed cap, or cheaper generation). Never a silent cap raise.
 * @param {{ f1: Parameters<typeof sizeGateFailures>[0], f0: Parameters<typeof sizeGateFailures>[0],
 *           generationTimeRatio: number }} input
 * @returns {{ flags?: 0 | 1, decision: 'keep-f1' | 'switch-f0' | 'escalate', failures: string[] }}
 */
export function bundledFlags({ f1, f0, generationTimeRatio }) {
  if (!Number.isFinite(generationTimeRatio) || generationTimeRatio <= 0)
    throw new RangeError('bundledFlags: generationTimeRatio must be a positive number');
  const f1Failures = sizeGateFailures({ ...f1, gaddag: true });
  if (f1Failures.length === 0) return { flags: 1, decision: 'keep-f1', failures: [] };
  const failures = [...f1Failures, ...sizeGateFailures({ ...f0, gaddag: false })];
  if (
    failures.length === f1Failures.length &&
    generationTimeRatio <= F0_SWITCH.maxGenerationTimeRatio
  )
    return { flags: 0, decision: 'switch-f0', failures };
  if (generationTimeRatio > F0_SWITCH.maxGenerationTimeRatio)
    failures.push(
      `f0: DAWG generation ${generationTimeRatio}x > ${F0_SWITCH.maxGenerationTimeRatio}x GADDAG`,
    );
  return { decision: 'escalate', failures };
}
