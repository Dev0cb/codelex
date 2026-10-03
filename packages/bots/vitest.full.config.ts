import { defineConfig } from 'vitest/config';

// Q4 full run (`pnpm test:full`): the 1,000-match real-lexicon property and its recorded results. Non-gating (not in
// `pnpm test`), no coverage, long timeout. Seeded like the gating run (test/setup.ts).
export default defineConfig({
  test: {
    include: ['test/full/**/*.full.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    silent: false,
  },
});
