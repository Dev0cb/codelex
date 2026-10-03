import { defineConfig } from 'vitest/config';

// Q-A2 measurement only (`pnpm bench` = `vitest bench`): non-gating, no coverage, long timeout. `pnpm test` never
// runs `*.bench.ts` files.
export default defineConfig({
  test: { testTimeout: 3_600_000, hookTimeout: 3_600_000, silent: false },
});
