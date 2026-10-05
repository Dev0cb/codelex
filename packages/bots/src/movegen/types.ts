import type { PlaceWordAction } from '@codelex/game-engine';
import type { BoardView } from '../board.js';

/**
 * A generated placement, deduplicated by its packed placement signature (bots-api §4.1 step 3). The canonical key
 * (§4.4) is not stored: `candidateKey` builds it for the candidates a policy keeps.
 */
export interface Candidate {
  /** Canonical PLACE_WORD (tiles sorted by (row, col)). */
  readonly action: PlaceWordAction;
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

/** One move generator per automaton (BOT-8): GADDAG path, DAWG fallback (P-BOT-03: same move set). */
export type MoveGenerator = (input: GenerationInput) => Generation;
