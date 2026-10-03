/**
 * Rule-correct fallback (BOT-6, R-TURN-001) when no PLACE_WORD is chosen: EXCHANGE of the whole rack minus blanks
 * (the whole rack if it holds only blanks) when `bagCount ≥ RULES.minBagForExchange`, else PASS. Never RESIGN.
 */
import {
  RULES,
  type ExchangeAction,
  type Observation,
  type PassAction,
  type RackTile,
} from '@codelex/game-engine';

export function fallbackAction(obs: Observation, seat: number): ExchangeAction | PassAction {
  const rack = Array.from(obs.rack) as RackTile[];
  if (rack.length > 0 && obs.bagCount >= RULES.minBagForExchange) {
    const letters = rack.filter((t) => t !== '?');
    const tiles = (letters.length > 0 ? letters : rack).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return { seat, type: 'EXCHANGE', tiles };
  }
  return { seat, type: 'PASS' };
}
