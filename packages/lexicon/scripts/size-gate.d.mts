// Type declarations for size-gate.mjs (lexicon-index note §5, sprint 3 task P7).

export const SIZE_GATE: Readonly<{
  maxBytes: number;
  maxBytesPerFormWithGaddag: number;
  maxBytesPerFormWithoutGaddag: number;
  maxFormsWithGaddag: number;
  maxGaddagToDawg: number;
}>;

export const F0_SWITCH: Readonly<{ maxGenerationTimeRatio: number }>;

export interface ArtefactSize {
  readonly bytes: number;
  readonly forms: number;
  readonly gaddag: boolean;
  /** DAWG_NODES + DAWG_EDGES bytes; required with the GADDAG. */
  readonly dawgBytes?: number;
  /** GADDAG_NODES + GADDAG_EDGES bytes; required with the GADDAG. */
  readonly gaddagBytes?: number;
}

/** Gate failures of one artefact; empty = pass. Throws RangeError on malformed measurements. */
export function sizeGateFailures(size: ArtefactSize): string[];

export function bundledFlags(input: {
  readonly f1: Omit<ArtefactSize, 'gaddag'>;
  readonly f0: Omit<ArtefactSize, 'gaddag'>;
  /** DAWG ÷ GADDAG generation time (bots qa2 bench, p95 per position). */
  readonly generationTimeRatio: number;
}): { flags?: 0 | 1; decision: 'keep-f1' | 'switch-f0' | 'escalate'; failures: string[] };
