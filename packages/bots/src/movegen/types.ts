import type { PlaceWordAction } from '@codelex/game-engine';
import type { BoardView } from '../board.js';

/** A generated placement, deduplicated by its canonical key (bots-api §4.1 step 3, §4.4). */
export interface Candidate {
  /** Canonical PLACE_WORD (tiles sorted by (row, col)). */
  readonly action: PlaceWordAction;
  readonly key: string;
  readonly tilesPlaced: number;
}

export interface GenerationInput {
  readonly view: BoardView;
  /** 27 rack counts (index 26 = blank); copied, never mutated. */
  readonly rack: readonly number[];
  readonly seat: number;
  /** BOT-3: max automaton transitions; generation stops (best-so-far) when reached. */
  readonly maxNodes: number;
}

export interface Generation {
  /** In generation order (anchors (row, col), direction row then col, arcs ascending, blanks last). */
  readonly candidates: readonly Candidate[];
  readonly nodesUsed: number;
  /** True iff a transition was dropped because `maxNodes` was reached (BOT-4). */
  readonly exhausted: boolean;
}

/** One move generator per automaton (BOT-8): the GADDAG path today, the DAWG path once L5 lands (O-1). */
export type MoveGenerator = (input: GenerationInput) => Generation;
