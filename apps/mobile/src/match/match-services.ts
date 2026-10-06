import type { SeedHex } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { getRandomBytes } from 'expo-crypto';
import { createContext } from 'react';

import { createDeviceFs } from '../persistence/device-fs';
import { createPersistence, type Persistence } from '../persistence/saved-match';
import { createJsThreadBotRunner, type BotRunner } from './bot-runner';
import { seedFromBytes, thinkDelayMs } from './play-config';

/** Platform effects of a match, injected so tests can pin the seed, the pace, the bot runtime and the disk. */
export interface MatchServices {
  /** A fresh 64-bit seed per match (CSPRNG on device). */
  readonly newSeed: () => SeedHex;
  /** The bot runtime (P5 option A today; a worker runtime later behind the same seam). */
  readonly createBotRunner: (lexicon: LexiconIndex) => BotRunner;
  /** Presentation delay of one bot move (D-29); never enters the engine. */
  readonly thinkDelayMs: () => number;
  /** Uniform [0, 1) for Shuffle (AC-7): a local rack order only, never an engine input. */
  readonly shuffleRandom: () => number;
  /** On-device match persistence (slice S3); absent = matches are not saved. Called once per session provider. */
  readonly persistence?: () => Persistence;
}

let devicePersistence: Persistence | undefined;

export const DEVICE_MATCH_SERVICES: MatchServices = {
  newSeed: () => seedFromBytes(getRandomBytes(8)),
  createBotRunner: (lexicon) => createJsThreadBotRunner(lexicon),
  // Presentation only (pace, rack order), so a non-seeded source is fine; game randomness comes from the seed.
  thinkDelayMs: () => thinkDelayMs(Math.random),
  shuffleRandom: Math.random,
  // One journal per process: the data directory is opened lazily, on the first file call.
  persistence: () => (devicePersistence ??= createPersistence(createDeviceFs())),
};

export const MatchServicesContext = createContext<MatchServices>(DEVICE_MATCH_SERVICES);
