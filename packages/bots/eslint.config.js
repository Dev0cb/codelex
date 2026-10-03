import { codelex } from '@codelex/config/eslint';

/**
 * BOT-2 (bots-api §2, ADR-0013 §D1/§D9): bots see an Observation and a host-derived Rng only. Shipped code may not
 * touch the match state, the seed or the stream derivation; tests may (they play the host's role).
 * `@typescript-eslint/no-restricted-imports` is used so that the preset's base `no-restricted-imports` (banned
 * clock/entropy modules) stays in force: two rules, not one overridden.
 */
const STATE_AND_SEED_API = [
  'MatchState',
  'SeatState',
  'apply',
  'createMatch',
  'replay',
  'parseState',
  'serializeState',
  'stateHash',
  'observe',
  'deriveStream',
  'deriveRng',
  'deriveStreamState',
  'createRng',
  'stateFromDigest',
];
const MESSAGE =
  'Bots never read MatchState, the seed or stream derivation; use the Observation and ctx.rng (bots-api BOT-2).';

export default [
  ...codelex({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@codelex/game-engine', importNames: STATE_AND_SEED_API, message: MESSAGE },
            { name: '@codelex/game-engine/rng', importNames: STATE_AND_SEED_API, message: MESSAGE },
          ],
          patterns: [
            {
              group: ['@codelex/game-engine/*', '!@codelex/game-engine/rng'],
              message: 'Only the public entry points of @codelex/game-engine (bots-api BOT-2).',
            },
          ],
        },
      ],
    },
  },
];
