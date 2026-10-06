/**
 * Test support (not shipped: nothing in the app imports it). Loads the very `.clxi` that `prepare:lexicon` bundles,
 * through the real loader; callers mock expo-asset, expo-crypto and expo-file-system with the Node stand-ins in
 * `jest/` (see jest.config.js). The scripted player uses the Beginner on test-only streams, never the bot's own.
 */
import { chooseAction, PERSONALITIES } from '@codelex/bots';
import {
  createMatch,
  deriveRng,
  observe,
  type Action,
  type Letter,
  type MatchState,
  type PlaceWordAction,
  type SeedHex,
} from '@codelex/game-engine';

import { createBundledLexiconSource } from '../lexicon/bundled-lexicon-source';
import { loadLexicon, type LoadedLexicon } from '../lexicon/load-lexicon';
import type { MatchCommand, MatchModel } from './match-model';
import { HUMAN_SEAT, PLAY_BOT, playMatchConfig } from './play-config';

let cached: Promise<LoadedLexicon> | undefined;

export function loadBundledLexicon(): Promise<LoadedLexicon> {
  cached ??= loadLexicon(createBundledLexiconSource()).then((result) => {
    if (!result.ok) throw new Error(`bundled lexicon failed to load: ${result.error.code}`);
    return result.value;
  });
  return cached;
}

/** `n` as a seed (16 hex chars). */
export const seedOf = (n: number): SeedHex => n.toString(16).padStart(16, '0') as SeedHex;

/** A new play match for `seed`; throws on an engine error (tests only). */
export function newPlayState(seed: SeedHex, lexicon: LoadedLexicon): MatchState {
  const created = createMatch(playMatchConfig(seed, lexicon.index), { lexicon: lexicon.index });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.state;
}

/** The first seed from `from` whose match the given seat starts (R-CORE-004 draw). */
export function seedWhereFirst(seat: number, lexicon: LoadedLexicon, from = 1): SeedHex {
  for (let n = from; n < from + 64; n += 1) {
    if (newPlayState(seedOf(n), lexicon).firstSeat === seat) return seedOf(n);
  }
  throw new Error('no seed found');
}

export const humanStarts = (lexicon: LoadedLexicon, from?: number): SeedHex =>
  seedWhereFirst(HUMAN_SEAT, lexicon, from);

/** The Beginner's choice for the seat on turn, from a test-only stream (never the bot's own `bot:<seat>:<n>`). */
export function scriptedAction(state: MatchState, stream: string, lexicon: LoadedLexicon): Action {
  const decided = chooseAction(observe(state, state.seatOnTurn), {
    lexicon: lexicon.index,
    rng: deriveRng(state.seed, stream),
    personality: PLAY_BOT,
    budget: PERSONALITIES[PLAY_BOT].budget,
  });
  if (!decided.ok) throw new Error(decided.error.message);
  return decided.value.action;
}

/** The first word the Beginner finds for the seat on turn over the streams `test:<n>`; throws if none. */
export function firstWordFor(state: MatchState, lexicon: LoadedLexicon): PlaceWordAction {
  for (let n = 0; n < 50; n += 1) {
    const action = scriptedAction(state, `test:${String(n)}`, lexicon);
    if (action.type === 'PLACE_WORD') return action;
  }
  throw new Error('no word found');
}

/** Commands that place `action`'s tiles through the rack, as a player would (tap tile, tap square, blank letter). */
export function placeCommands(model: MatchModel, action: PlaceWordAction): MatchCommand[] {
  const used = new Set<number>();
  const commands: MatchCommand[] = [];
  for (const tile of action.tiles) {
    const isBlank = tile.tile === tile.tile.toLowerCase();
    const slot = model.slots.find((s) => !used.has(s.id) && s.tile === (isBlank ? '?' : tile.tile));
    if (slot === undefined) throw new Error(`no rack tile for ${tile.tile}`);
    used.add(slot.id);
    commands.push({ type: 'select', slotId: slot.id });
    commands.push({ type: 'press_square', row: tile.row, col: tile.col });
    if (isBlank) commands.push({ type: 'choose_blank', letter: tile.tile.toUpperCase() as Letter });
  }
  return commands;
}
