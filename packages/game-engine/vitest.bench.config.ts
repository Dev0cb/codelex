import { defineConfig } from 'vitest/config';

// Non-gating benchmarks (`pnpm bench`): only the dedicated benchmark project on test/bench, no coverage.
// `pnpm test` (vitest.config.ts, strict preset) never enables benchmarks, so it never runs them.
export default defineConfig({
  test: {
    include: [],
    passWithNoTests: true,
    testTimeout: 300_000,
    // Load built packages natively (no module-runner export getters in the measured calls).
    server: { deps: { external: [/\/dist\//] } },
    benchmark: { enabled: true, include: ['test/bench/**/*.bench.ts'] },
  },
});
