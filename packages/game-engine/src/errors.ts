/**
 * Builders for the three failure families of API note §8 (API-5): player-level `Rejection` (lowercase rule
 * codes) and system-level `EngineError` (UPPER_SNAKE). Messages are developer English and carry no player data.
 */
import type {
  EngineContext,
  EngineError,
  EngineErrorCode,
  MalformedViolation,
  PlacementViolation,
  Rejection,
  Seat,
  TileString,
} from './types.js';
import { ENGINE_RULES_VERSION } from './version.js';

export function engineError(
  code: EngineErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number>>,
): EngineError {
  return details === undefined
    ? { kind: 'engine', code, message }
    : { kind: 'engine', code, message, details };
}

/**
 * Total over any value (review R1 m1): a finite number or a string is reported as is, anything else by its
 * `typeof` only. Nothing is stringified, so no `toString`/`valueOf` of untrusted JSON ever runs or throws, and
 * no `NaN`/`Infinity` reaches the details (n4).
 */
function describeVersion(actual: unknown): string | number {
  if (typeof actual === 'number') return Number.isFinite(actual) ? actual : 'number';
  return typeof actual === 'string' ? actual : typeof actual;
}

export function rulesVersionError(actual: unknown): EngineError {
  return engineError('RULES_VERSION_UNSUPPORTED', 'unsupported engineRulesVersion', {
    expected: ENGINE_RULES_VERSION,
    actual: describeVersion(actual),
  });
}

/** The pinned lexicon identity of a match (API note §5). */
export interface LexiconPin {
  readonly lexiconVersion: string;
  readonly profileId: string;
  readonly definitionHash: string;
}

/** `LEXICON_MISMATCH` when `ctx.lexicon` is not the index the match pins, else undefined (ADR-0013 Q-G1). */
export function lexiconMismatch(pin: LexiconPin, ctx: EngineContext): EngineError | undefined {
  const { version, profile } = ctx.lexicon;
  if (
    version === pin.lexiconVersion &&
    profile.id === pin.profileId &&
    profile.definitionHash === pin.definitionHash
  ) {
    return undefined;
  }
  return engineError('LEXICON_MISMATCH', 'lexicon index does not match the match pin', {
    expected: `${pin.lexiconVersion}/${pin.profileId}/${pin.definitionHash}`,
    actual: `${version}/${profile.id}/${profile.definitionHash}`,
  });
}

export function matchOver(): Rejection {
  return { kind: 'rejection', code: 'match_over', message: 'the match is over' };
}

export function malformed(violation: MalformedViolation, field: string): Rejection {
  return {
    kind: 'rejection',
    code: 'malformed',
    message: `malformed action: ${violation} at ${field === '' ? '<root>' : field}`,
    details: { violation, field },
  };
}

export function notYourTurn(seatOnTurn: Seat, seatInactive: boolean): Rejection {
  return {
    kind: 'rejection',
    code: 'not_your_turn',
    message: seatInactive ? 'the seat is no longer active' : "not this seat's turn",
    details: { seatOnTurn, seatInactive },
  };
}

export function rackRejection(missing: TileString): Rejection {
  return {
    kind: 'rejection',
    code: 'rack',
    message: 'tiles not on the rack',
    details: { missing },
  };
}

export function placementRejection(violation: PlacementViolation): Rejection {
  return {
    kind: 'rejection',
    code: 'placement',
    message: `invalid placement: ${violation}`,
    details: { violation },
  };
}

export function notInLexicon(
  words: readonly { readonly form: string; readonly main: boolean }[],
): Rejection {
  return {
    kind: 'rejection',
    code: 'not_in_lexicon',
    message: 'formed word(s) not in the lexicon',
    details: { words },
  };
}

export function exchangeRejection(violation: 'tile_count' | 'bag_too_small'): Rejection {
  return {
    kind: 'rejection',
    code: 'exchange',
    message: `invalid exchange: ${violation}`,
    details: { violation },
  };
}
