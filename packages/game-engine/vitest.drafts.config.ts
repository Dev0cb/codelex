import { defineConfig } from 'vitest/config';

// `pnpm drafts:write`: regenerates the MUTABLE draft goldens (test/golden/drafts/, ADR-0014 §D3). Never part of
// `pnpm test` (vitest.config.ts only collects *.test.ts), so CI only ever checks them.
export default defineConfig({
  test: {
    include: ['test/drafts/write.draft.ts'],
    testTimeout: 300_000,
  },
});
