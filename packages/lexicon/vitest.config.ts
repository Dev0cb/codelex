import { strictPreset, defineCodelexVitest } from '@codelex/config/vitest';

// Strict preset (90 %): `@codelex/lexicon/index` is on the rules path (R-TURN-003, lexicon-index note §7)
// and is imported by packages/game-engine. Vitest runs the TypeScript tests in src/ only: test/*.test.mjs
// are node:test suites for the zero-dependency scripts, run by `node --test` (no install needed).
export default defineCodelexVitest(strictPreset, {
  test: { include: ['src/**/*.test.ts'] },
});
