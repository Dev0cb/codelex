/**
 * Validation half of `apply` (API note §8.3, API-10): every check in the fixed precedence, no state change.
 * `apply` (E4) performs the validated action; a failure here is the only output and the state is untouched
 * (P-GLOBAL-03, R-TURN-005).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { exchangeTiles, type Exchanged } from '../bag/bag.js';
import { lexiconMismatch, matchOver, notYourTurn, rulesVersionError } from '../errors.js';
import { checkPlacement, type CheckedPlacement } from '../placement/check.js';
import { getLayout } from '../rules/constants.js';
import type {
  ApplyFailure,
  EngineContext,
  ExchangeAction,
  MatchState,
  PassAction,
  PlaceWordAction,
  ResignAction,
} from '../types.js';
import { ENGINE_RULES_VERSION } from '../version.js';
import { parseAction } from './parse.js';

export type ValidatedAction =
  | {
      readonly type: 'PLACE_WORD';
      readonly action: PlaceWordAction;
      readonly placement: CheckedPlacement;
    }
  | { readonly type: 'EXCHANGE'; readonly action: ExchangeAction; readonly exchange: Exchanged }
  | { readonly type: 'PASS'; readonly action: PassAction }
  | { readonly type: 'RESIGN'; readonly action: ResignAction };

/**
 * Checks `input` against `state` in the order of API note §8.3:
 * 1. `RULES_VERSION_UNSUPPORTED`, `LEXICON_MISMATCH`; 2. `match_over`; 3. `malformed`; 4. `not_your_turn`
 * (skipped for RESIGN from an active seat; a resigned seat gets it with `seatInactive: true` for every action);
 * 5. PLACE_WORD placement/rack/lexicon checks, EXCHANGE exchange/rack checks.
 */
export function validateAction(
  state: MatchState,
  input: unknown,
  ctx: EngineContext,
): Result<ValidatedAction, ApplyFailure> {
  // Typed as 1, but a hand-built or future state may carry another version (ADR-0013 §D6).
  if ((state.engineRulesVersion as number) !== ENGINE_RULES_VERSION) {
    return err(rulesVersionError(state.engineRulesVersion));
  }
  const mismatch = lexiconMismatch(state, ctx);
  if (mismatch !== undefined) return err(mismatch);
  if (state.status === 'finished') return err(matchOver());

  const parsed = parseAction(input, state.config.seats);
  if (!parsed.ok) return parsed;
  const action = parsed.value;

  const seat = state.seats[action.seat];
  if (seat === undefined || seat.status !== 'active') {
    return err(notYourTurn(state.seatOnTurn, true));
  }
  if (action.type === 'RESIGN') return ok({ type: 'RESIGN', action });
  if (action.seat !== state.seatOnTurn) return err(notYourTurn(state.seatOnTurn, false));

  switch (action.type) {
    case 'PASS':
      return ok({ type: 'PASS', action });
    case 'EXCHANGE': {
      const exchange = exchangeTiles(seat.rack, state.bag, state.rng.bag, action.tiles);
      return exchange.ok ? ok({ type: 'EXCHANGE', action, exchange: exchange.value }) : exchange;
    }
    case 'PLACE_WORD': {
      const placement = checkPlacement(
        {
          board: state.board,
          layout: getLayout(state.config.layout),
          rack: seat.rack,
          tiles: action.tiles,
        },
        ctx.lexicon,
      );
      return placement.ok
        ? ok({ type: 'PLACE_WORD', action, placement: placement.value })
        : placement;
    }
  }
}
