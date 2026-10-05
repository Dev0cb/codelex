/**
 * `chooseAction(obs, ctx)` (BOT-1): synchronous and pure apart from consuming `ctx.rng`. Pipeline of
 * bots-api §4.1: guards → board view and cross-checks → generation (budgeted) → personality policy → fallback.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { getLayout, type Observation } from '@codelex/game-engine';
import { boardView, rackCounts } from './board.js';
import { fallbackAction } from './fallback.js';
import { selectGenerator } from './movegen/index.js';
import { PERSONALITIES } from './personalities.js';
import { randomLegal } from './policy/random-legal.js';
import { ranked } from './policy/ranked.js';
import type { PolicyInput, PolicyResult } from './policy/types.js';
import type { BotBudget, BotContext, BotDecision, BotError, BotErrorCode } from './types.js';

function botError(code: BotErrorCode, message: string): BotError {
  return { kind: 'bot', code, message };
}

function validCap(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
}

/** Guards in the documented order (bots-api §3, P-BOT-08). */
export function checkPreconditions(obs: Observation, ctx: BotContext): BotError | undefined {
  if (obs.viewer === 'spectator') {
    return botError('NOT_A_SEAT', 'the observation is a spectator view');
  }
  if (obs.status === 'finished') return botError('MATCH_OVER', 'the match is over');
  if (obs.seatOnTurn !== obs.viewer) {
    return botError('NOT_ON_TURN', 'the observing seat is not on turn');
  }
  const { version, profile } = ctx.lexicon;
  if (
    version !== obs.lexiconVersion ||
    profile.id !== obs.profileId ||
    profile.definitionHash !== obs.definitionHash
  ) {
    return botError('LEXICON_MISMATCH', 'the lexicon index does not match the match pin');
  }
  // Hosts may pass untyped data (tests, simulator flags): check the shape, not only the values.
  const budget: unknown = ctx.budget;
  const caps: Readonly<Partial<Record<keyof BotBudget, unknown>>> =
    typeof budget === 'object' && budget !== null ? budget : {};
  if (!validCap(caps.maxNodes) || !validCap(caps.maxCandidates)) {
    return botError('INVALID_BUDGET', 'maxNodes and maxCandidates must be safe integers >= 1');
  }
  return undefined;
}

function runPolicy(ctx: BotContext, input: PolicyInput): PolicyResult {
  switch (ctx.personality) {
    case 'random-legal':
      return randomLegal(input);
    case 'beginner':
    case 'greedy':
      return ranked(input);
  }
}

export function chooseAction(obs: Observation, ctx: BotContext): Result<BotDecision, BotError> {
  const failure = checkPreconditions(obs, ctx);
  if (failure !== undefined) return err(failure);
  const seat = obs.seatOnTurn;
  const data = ctx.data ?? PERSONALITIES[ctx.personality];
  const view = boardView(obs, getLayout(obs.config.layout), ctx.lexicon);
  const generation = selectGenerator(ctx.lexicon).generate({
    view,
    rack: rackCounts(obs.rack),
    seat,
    maxNodes: ctx.budget.maxNodes,
  });
  const policy = runPolicy(ctx, {
    obs,
    lexicon: ctx.lexicon,
    engine:
      ctx.draft === undefined
        ? { lexicon: ctx.lexicon }
        : { lexicon: ctx.lexicon, draft: ctx.draft },
    rng: ctx.rng,
    budget: ctx.budget,
    data,
    view,
    candidates: generation.candidates,
  });
  return ok({
    action: policy.action ?? fallbackAction(obs, seat),
    nodesUsed: generation.nodesUsed,
    candidatesEvaluated: policy.candidatesEvaluated,
    candidatesRefused: policy.refused,
    budgetExhausted: generation.exhausted || policy.exhausted,
  });
}
