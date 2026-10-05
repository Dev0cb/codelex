/**
 * Writes the draft goldens (`pnpm drafts:write`, `vitest.drafts.config.ts`). Not part of `pnpm test`: only an
 * intentional draft change regenerates them (ADR-0014 §D3). Never writes outside `test/golden/drafts/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildDraftGolden, DRAFT_GOLDEN_DIR, DRAFT_GOLDENS } from './draft-goldens.js';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

it('writes test/golden/drafts/v2/*.json', () => {
  const dir = join(pkg, DRAFT_GOLDEN_DIR);
  mkdirSync(dir, { recursive: true });
  for (const { file, variant, seed } of DRAFT_GOLDENS) {
    const golden = buildDraftGolden(variant, seed);
    writeFileSync(join(dir, `${file}.json`), `${JSON.stringify(golden, null, 2)}\n`);
    expect(golden.actionCount).toBeGreaterThan(0);
  }
});
