/**
 * Validation half of `apply` (API note §8.3, API-10): every check in the fixed precedence, no state change.
 * `apply` (E4) performs the validated action; a failure here is the only output and the state is untouched
 * (P-GLOBAL-03, R-TURN-005).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { exchangeTiles, type Exchanged } from '../bag/bag.js';
import { assertNever, lexiconMismatch, matchOver, notYourTurn } from '../errors.js';
import { checkPlacement, type CheckedPlacement } from '../placement/check.js';
import { getLayout } from '../rules/constants.js';
import { resolveRules } from '../rules/registry.js';
import type {
  ApplyFailure,
  EngineContext,
  ExchangeAction,
  MatchState,
  PassAction,
  PlaceWordAction,
  ResignAction,
  Rules,
} from '../types.js';
import { parseAction } from './parse.js';

/** A validated action, with the match's rules resolved once for `apply` (ADR-0014 §D1). */
export type ValidatedAction = ValidatedKind & { readonly rules: Rules };

type ValidatedKind =
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
 * 1. `RULES_VERSION_UNSUPPORTED` (unregistered version, draft without `ctx.draft`, unknown candidate),
 *    `LEXICON_MISMATCH`; 2. `match_over`; 3. `malformed`; 4. `not_your_turn`
 * (skipped for RESIGN from an active seat; a resigned seat gets it with `seatInactive: true` for every action);
 * 5. PLACE_WORD placement/rack/lexicon checks, EXCHANGE exchange/rack checks.
 */
export function validateAction(
  state: MatchState,
  input: unknown,
  ctx: EngineContext,
): Result<ValidatedAction, ApplyFailure> {
  // Typed, but a hand-built or future state may carry another version (ADR-0014 §D2).
  const resolved = resolveRules(state.engineRulesVersion, ctx.draft);
  if (!resolved.ok) return resolved;
  const { rules } = resolved.value;
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
  if (action.type === 'RESIGN') return ok({ type: 'RESIGN', action, rules });
  if (action.seat !== state.seatOnTurn) return err(notYourTurn(state.seatOnTurn, false));

  switch (action.type) {
    case 'PASS':
      return ok({ type: 'PASS', action, rules });
    case 'EXCHANGE': {
      const exchange = exchangeTiles(seat.rack, state.bag, state.rng.bag, action.tiles, rules);
      return exchange.ok
        ? ok({ type: 'EXCHANGE', action, exchange: exchange.value, rules })
        : exchange;
    }
    case 'PLACE_WORD': {
      const placement = checkPlacement(
        {
          board: state.board,
          layout: getLayout(state.config.layout),
          rack: seat.rack,
          tiles: action.tiles,
          rules,
        },
        ctx.lexicon,
      );
      return placement.ok
        ? ok({ type: 'PLACE_WORD', action, placement: placement.value, rules })
        : placement;
    }
    default:
      return assertNever(action);
  }
}
