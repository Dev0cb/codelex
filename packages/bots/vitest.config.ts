import { strictPreset, defineCodelexVitest } from '@codelex/config/vitest';

// Strict preset: 90 % on lines, statements, functions and branches. Property tests are seeded (test/setup.ts).
export default defineCodelexVitest(strictPreset, {
  test: { setupFiles: ['test/setup.ts'], testTimeout: 30_000 },
});
