/**
 * Gameplay analytics of the vs-bot match (E-1.5 AC-17; sprint 4 EV): `bot_match_started`, `bot_match_finished`,
 * `bot_match_abandoned`, `bot_match_resumed`, `bot_decision_made`, `bot_word_played`, `word_rejected` and
 * `match_summary_action`, with exactly the catalogue properties (`docs/standards/ANALYTICS_EVENTS.md`). Every value
 * is read from the engine's state and events (scores, results, breakdowns), never recomputed here.
 *
 * Off the critical path: the match session queues each call and runs it after React committed the move (an effect),
 * so a move is written to the match log and shown before any analytics work starts; the only file writes here are
 * the small open-match record (start, rejection, background, resume, end), never one per move. Everything is a no-op
 * unless the recorder is recording (`analytics.upload.enabled` and consent): then nothing is emitted or written,
 * only the in-memory clocks run.
 *
 * Match identity: `local_match_id` is a random UUID kept in the open-match record (`analytics.play`, purged with
 * consent off), bound to the match by a CRC-32 of its seed (on-device only, never emitted), so it survives a cold
 * start. A match whose record is missing (recording turned on mid-match, record purged) adopts a new id with zero
 * counters at its next event; such a match has no `bot_match_started`.
 *
 * Clocks are the recorder's monotonic clock: `active_duration_ms` sums the foreground time while the match is open
 * on this process (a crash loses the interval since the last background: a lower bound); `think_ms` of the player is
 * foreground time from the start of their turn (move rendered) to PLAY; `think_ms` of the bot is its compute time
 * (the think delay excluded, design §11).
 */
import type { BotDecision, BotPersonalityId } from '@codelex/bots';
import { BOT_VERSION } from '@codelex/bots';
import type { MatchState, Rejection } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';

import type { AnalyticsCall } from '../analytics/emitter';
import {
  GUARD_BOT_PERSONALITIES,
  GUARD_CATEGORY_IDS,
  GUARD_COMPUTE_MS_BUCKETS,
  GUARD_NODES_USED_BUCKETS,
} from '../analytics/event-guard';
import type { EventProperties } from '../analytics/events';
import { crc32 } from '../persistence/crc32';
import type { RestorePath } from '../persistence/resume';
import { livePreview, matchOutcome, type MatchCommand, type MatchModel } from './match-model';
import { BOT_SEAT, HUMAN_SEAT, PLAY_BOT } from './play-config';

export type OnboardingStep = EventProperties<'onboarding_step_completed'>['step'];
export type SummaryAction = EventProperties<'match_summary_action'>['action'];
type Personality = EventProperties<'bot_match_started'>['bot_personality'];
type MsBucket = EventProperties<'bot_decision_made'>['compute_ms_bucket'];
type NodesBucket = EventProperties<'bot_decision_made'>['nodes_used_bucket'];
type BonusFlag = EventProperties<'bot_word_played'>['bonus_flags'][number];

/** What the telemetry needs from the recorder (`PlaytestAnalytics` implements it). */
export interface TelemetryHost {
  /** `analytics.upload.enabled`, consent on and the recorder started. */
  isRecording(): boolean;
  emit(call: AnalyticsCall): void;
  /** Monotonic clock (ms), the recorder's. */
  monoNow(): number;
  /** Device wall clock (ms): only the cold-start `away_ms`. */
  wallNow(): number;
  /** A random UUID v4. */
  newId(): string;
  /** The open-match record file; null when absent or unreadable. */
  readPlayRecord(): string | null;
  writePlayRecord(text: string): void;
  onboardingStep(step: OnboardingStep): void;
}

/**
 * ASSUMPTION (EV, reversible): at most this many `word_rejected` per turn; `rejected_attempts` on
 * `bot_match_finished` still counts every one. PLAY stays enabled on a rejected placement (D-5), so repeated taps
 * could otherwise fill the 5,000-event queue.
 */
export const MAX_REJECTED_EVENTS_PER_TURN = 10;

/** The cold start's view of the saved match (`SavedMatch` of `persistence/saved-match.ts`). */
export type ColdRestore =
  | { readonly kind: 'none' }
  | { readonly kind: 'resumable'; readonly model: MatchModel; readonly path: RestorePath }
  | { readonly kind: 'version_mismatch' }
  | { readonly kind: 'state_corrupt' };

interface OpenMatch {
  id: string;
  /** CRC-32 (hex) of the match seed; '' when adopted without a state (a failed restore). */
  key: string;
  activeMs: number;
  rejected: number;
  resumes: number;
  turns: number;
  /** Wall clock of the last background or start: the cold-start `away_ms`. */
  lastWall: number;
  /** A failed restore was reported: no second `bot_match_abandoned` for this id. */
  closed: boolean;
}

interface PlayRecord {
  /** Matches started on this install while recording (`is_first_match`). */
  started: number;
  open: OpenMatch | null;
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const ms = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

function parseOpen(value: unknown): OpenMatch | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const { id, key, activeMs, rejected, resumes, turns, lastWall, closed } = o;
  if (
    typeof id !== 'string' ||
    typeof key !== 'string' ||
    !isCount(activeMs) ||
    !isCount(rejected) ||
    !isCount(resumes) ||
    !isCount(turns) ||
    !isCount(lastWall) ||
    typeof closed !== 'boolean'
  ) {
    return null;
  }
  return { id, key, activeMs, rejected, resumes, turns, lastWall, closed };
}

/** The stored record; a missing or unreadable one is a fresh record (the event guard still checks every id). */
export function parsePlayRecord(text: string | null): PlayRecord {
  if (text === null) return { started: 0, open: null };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return { started: 0, open: null };
    const { v, started, open } = parsed as Record<string, unknown>;
    if (v !== 1 || !isCount(started)) return { started: 0, open: null };
    return { started, open: parseOpen(open) };
  } catch {
    return { started: 0, open: null };
  }
}

const keyOf = (state: MatchState): string =>
  crc32(Uint8Array.from(state.seed, (c) => c.charCodeAt(0))).toString(16);

const personalityOf = (id: BotPersonalityId): Personality | null =>
  (GUARD_BOT_PERSONALITIES as readonly string[]).includes(id) ? (id as Personality) : null;

const MS_EDGES = [250, 500, 1000, 1500, 2000, 3000, 4000];
const NODE_EDGES = [1000, 10_000, 50_000, 100_000, 200_000];

/** Catalogue "Latency and node buckets": lower bound inclusive, upper bound exclusive. */
export function msBucket(value: number): MsBucket {
  const i = MS_EDGES.findIndex((edge) => value < edge);
  return GUARD_COMPUTE_MS_BUCKETS[i === -1 ? MS_EDGES.length : i] as MsBucket;
}

export function nodesBucket(value: number): NodesBucket {
  const i = NODE_EDGES.findIndex((edge) => value < edge);
  return GUARD_NODES_USED_BUCKETS[i === -1 ? NODE_EDGES.length : i] as NodesBucket;
}

/** `word_rejected.reason`: the engine's codes aggregated to the catalogue's three values (design §11). */
export function rejectedReason(
  rejection: Rejection | null,
): EventProperties<'word_rejected'>['reason'] {
  if (rejection?.code !== 'not_in_lexicon') return 'placement';
  return rejection.details.words.some((w) => w.main) ? 'not_in_lexicon' : 'cross_word';
}

type Category = EventProperties<'bot_word_played'>['category'];
const isCategory = (id: string | undefined): id is Category =>
  id !== undefined && (GUARD_CATEGORY_IDS as readonly string[]).includes(id);

const tilesOnBoard = (state: MatchState): number =>
  state.board.reduce((n, row) => n + row.replaceAll('.', '').length, 0);

/** `bot_match_finished` of a finished model, `null` when the model is not finished. */
export function finishedProperties(
  model: MatchModel,
  open: Pick<OpenMatch, 'id' | 'activeMs' | 'rejected' | 'resumes'>,
): EventProperties<'bot_match_finished'> | null {
  const { state } = model;
  const outcome = matchOutcome(state);
  const end = state.result?.end;
  const personality = personalityOf(PLAY_BOT);
  if (outcome === null || end === undefined || personality === null) return null;
  const player = state.seats[HUMAN_SEAT]?.score ?? 0;
  const bot = state.seats[BOT_SEAT]?.score ?? 0;
  const endReason =
    end.reason === 'going_out'
      ? 'out'
      : end.reason === 'scoreless_turns'
        ? 'scoreless_turns'
        : 'resign';
  const bag = state.bag.length;
  let tail = 0;
  if (endReason === 'scoreless_turns' && bag < 7) {
    // Passes do not draw: every trailing pass was taken with the bag at its final count.
    for (let i = model.actions.length - 1; i >= 0 && model.actions[i]?.type === 'PASS'; i -= 1) {
      tail += 1;
    }
  }
  const count = (type: string): number => model.actions.filter((a) => a.type === type).length;
  return {
    local_match_id: open.id,
    bot_personality: personality,
    bot_version: BOT_VERSION,
    engine_rules_version: state.engineRulesVersion,
    result: outcome === 'victory' ? 'win' : outcome === 'defeat' ? 'loss' : 'draw',
    end_reason: endReason,
    player_score: player,
    bot_score: bot,
    score_margin: player - bot,
    bag_count_at_end: bag,
    tiles_on_board_at_end: tilesOnBoard(state),
    forced_pass_tail: tail,
    active_duration_ms: ms(open.activeMs),
    turns: state.turnNumber,
    words_played: count('PLACE_WORD'),
    rejected_attempts: open.rejected,
    exchanges: count('EXCHANGE'),
    passes: count('PASS'),
    resume_count: open.resumes,
  };
}

export class MatchTelemetry {
  private record: PlayRecord | null = null;
  private foreground = true;
  private backgroundSince: number | null = null;
  /** A match is open and in progress on this process (its time counts). */
  private live = false;
  private segmentSince: number | null = null;
  /** Active time not yet added to the open record. */
  private activeBank = 0;
  /** The player's turn clock: running since `turnSince`, plus `turnBank` from before a background. */
  private playerTurn = false;
  private turnSince: number | null = null;
  private turnBank = 0;
  private rejectedThisTurn = 0;
  /** The next bot decision recomputes one lost with the previous process (AC-11). */
  private recompute = false;
  private lastFinishedId: string | null = null;
  private summaryShownAt: number | null = null;

  constructor(
    private readonly host: TelemetryHost,
    private readonly lexicon: LexiconIndex,
  ) {}

  readonly now = (): number => this.host.monoNow();

  /** PLAY NOW, Play again, New match, Start a new match: the previous match (if open) is abandoned first. */
  replaced(previous: MatchModel | null): void {
    this.endLive(this.now());
    if (!this.on()) return;
    const record = this.load();
    const open = record.open;
    if (open !== null && !open.closed) {
      this.bankInto(open);
      this.host.emit({
        event: 'bot_match_abandoned',
        properties: {
          local_match_id: open.id,
          reason: 'replaced_by_new',
          turns: previous?.state.turnNumber ?? open.turns,
          active_duration_ms: ms(open.activeMs),
        },
      });
    }
    if (open !== null) {
      record.open = null;
      this.save();
    }
  }

  /** A new match was created. `hadHistory`: a finished match is already on this device (legacy installs). */
  started(model: MatchModel, hadHistory: () => boolean): void {
    const at = this.now();
    this.activeBank = 0;
    this.lastFinishedId = null;
    this.recompute = false;
    this.goLive(model, at);
    if (!this.on()) return;
    const record = this.load();
    const { state } = model;
    const personality = personalityOf(PLAY_BOT);
    const open = this.fresh(keyOf(state));
    const isFirst = record.started === 0 && !hadHistory();
    record.started += 1;
    record.open = open;
    this.save();
    if (personality === null) return;
    this.host.emit({
      event: 'bot_match_started',
      properties: {
        local_match_id: open.id,
        mode: 'classic',
        format: 'untimed-vs-bot',
        bot_personality: personality,
        first_player: state.firstSeat === HUMAN_SEAT ? 'player' : 'bot',
        lexicon_version: state.lexiconVersion,
        engine_rules_version: state.engineRulesVersion,
        bot_version: BOT_VERSION,
        is_first_match: isFirst,
      },
    });
  }

  /** The saved match was read at start (cold start, after the first render). */
  restored(saved: ColdRestore, restoreMs: number): void {
    if (!this.on()) return;
    const record = this.load();
    if (saved.kind === 'none') {
      // Nothing to resume (or a match finished by `openSavedMatch` itself): a leftover record is stale.
      if (record.open !== null) {
        record.open = null;
        this.save();
      }
      return;
    }
    const wall = this.host.wallNow();
    if (saved.kind === 'resumable') {
      const key = keyOf(saved.model.state);
      const adopted = record.open?.key !== key;
      const open = this.ensureOpen(key);
      open.resumes += 1;
      open.turns = saved.model.state.turnNumber;
      this.save();
      this.host.emit({
        event: 'bot_match_resumed',
        properties: {
          local_match_id: open.id,
          resume_source: 'cold_start',
          away_ms: adopted ? 0 : ms(wall - open.lastWall),
          restore_ms: ms(restoreMs),
          restore_path: saved.path,
        },
      });
      return;
    }
    const known = record.open;
    if (known?.closed === true) return;
    const open = known ?? this.fresh('');
    record.open = open;
    open.closed = true;
    this.save();
    this.host.emit({
      event: 'bot_match_resumed',
      properties: {
        local_match_id: open.id,
        resume_source: 'cold_start',
        away_ms: known === null ? 0 : ms(wall - open.lastWall),
        restore_ms: ms(restoreMs),
        restore_path: 'failed',
      },
    });
    this.host.emit({
      event: 'bot_match_abandoned',
      properties: {
        local_match_id: open.id,
        reason: saved.kind,
        turns: open.turns,
        active_duration_ms: ms(open.activeMs),
      },
    });
  }

  /** The player resumed the saved match (PLAY NOW on the resume card). */
  resumedSaved(model: MatchModel): void {
    this.activeBank = 0;
    this.lastFinishedId = null;
    this.recompute = model.state.status === 'in_progress' && model.state.seatOnTurn === BOT_SEAT;
    this.goLive(model, this.now());
  }

  /**
   * A command changed the model. `at`: when it was dispatched (PLAY tapped, bot decision arrived); this runs after
   * the move was rendered.
   */
  transition(previous: MatchModel, next: MatchModel, command: MatchCommand, at: number): void {
    const drawnAt = this.now();
    if (next.actions.length > previous.actions.length) {
      this.applied(previous, next, command, at, drawnAt);
    } else if (command.type === 'play' && next.rejection !== null) {
      this.rejected(next, at);
    }
  }

  /** `AppState` moved (the session subscribes). `liveModel`: the session's open match, if any. */
  appState(next: string, liveModel: MatchModel | null): void {
    const at = this.now();
    if (next === 'background' && this.foreground) {
      this.foreground = false;
      this.backgroundSince = at;
      this.pause(at);
      if (!this.on() || liveModel === null || !this.live) return;
      const open = this.ensureOpen(keyOf(liveModel.state));
      this.bankInto(open);
      open.lastWall = this.host.wallNow();
      open.turns = liveModel.state.turnNumber;
      this.save();
    } else if (next === 'active' && !this.foreground) {
      this.foreground = true;
      const away = this.backgroundSince === null ? 0 : at - this.backgroundSince;
      this.backgroundSince = null;
      if (this.live) this.segmentSince = at;
      if (this.playerTurn) this.turnSince = at;
      if (!this.on() || liveModel === null || !this.live) return;
      const open = this.ensureOpen(keyOf(liveModel.state));
      open.resumes += 1;
      this.save();
      this.host.emit({
        event: 'bot_match_resumed',
        properties: {
          local_match_id: open.id,
          resume_source: 'background',
          away_ms: ms(away),
          restore_ms: 0,
          restore_path: 'in_memory',
        },
      });
    }
  }

  /** The Summary of the match that just finished is on screen. */
  summaryShown(): void {
    this.summaryShownAt = this.now();
  }

  /** An action tapped on the Summary. */
  summaryAction(action: SummaryAction): void {
    const id = this.lastFinishedId;
    if (id === null || !this.on()) return;
    const shown = this.summaryShownAt;
    this.host.emit({
      event: 'match_summary_action',
      properties: {
        local_match_id: id,
        action,
        ms_on_summary: shown === null ? 0 : ms(this.now() - shown),
      },
    });
  }

  // --- internals ----------------------------------------------------------------------------------------------

  private applied(
    previous: MatchModel,
    next: MatchModel,
    command: MatchCommand,
    at: number,
    drawnAt: number,
  ): void {
    const finished = next.state.status === 'finished';
    const thinkMs = ms(this.turnBank + (this.turnSince === null ? 0 : at - this.turnSince));
    if (finished) this.endLive(drawnAt);
    else if (next.state.seatOnTurn === HUMAN_SEAT) this.startTurn(drawnAt);
    else this.stopTurn();
    if (!this.on()) return;
    const open = this.ensureOpen(keyOf(next.state));
    open.turns = next.state.turnNumber;
    const turn = previous.state.turnNumber;
    let botMs = 0;
    if (command.type === 'bot_decided' && command.result.ok) {
      const timing = command.timing;
      botMs = timing === undefined ? 0 : ms(timing.resolvedAt - timing.requestedAt);
      const total = timing === undefined ? 0 : ms(drawnAt - timing.requestedAt);
      this.decision(open.id, previous.state, command.result.value, botMs, total);
    }
    for (const entry of next.log.slice(previous.log.length)) {
      if (entry.kind !== 'word') continue;
      const human = entry.seat === HUMAN_SEAT;
      const props = this.wordProperties(
        entry.breakdown,
        open.id,
        human,
        human ? thinkMs : botMs,
        turn,
      );
      if (props !== null) this.host.emit({ event: 'bot_word_played', properties: props });
    }
    this.host.onboardingStep('first_move');
    if (!finished) return;
    this.bankInto(open);
    const props = finishedProperties(next, open);
    const record = this.load();
    record.open = null;
    this.save();
    this.lastFinishedId = open.id;
    if (props !== null) this.host.emit({ event: 'bot_match_finished', properties: props });
    this.host.onboardingStep('first_match_completed');
  }

  private decision(
    id: string,
    before: MatchState,
    decision: BotDecision,
    computeMs: number,
    totalMs: number,
  ): void {
    const personality = personalityOf(PLAY_BOT);
    const { action } = decision;
    if (personality === null || action.type === 'RESIGN') return;
    const recomputed = this.recompute;
    this.recompute = false;
    this.host.emit({
      event: 'bot_decision_made',
      properties: {
        local_match_id: id,
        action_index: before.actionCount,
        bot_personality: personality,
        bot_version: BOT_VERSION,
        engine_rules_version: before.engineRulesVersion,
        compute_ms_bucket: msBucket(computeMs),
        total_ms_bucket: msBucket(Math.max(totalMs, computeMs)),
        budget_exhausted: decision.budgetExhausted,
        nodes_used_bucket: nodesBucket(decision.nodesUsed),
        // BOT-8: the generator `@codelex/bots` selects for this index (GADDAG when present, else the DAWG).
        automaton: this.lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
        action_kind:
          action.type === 'PLACE_WORD'
            ? 'place_word'
            : action.type === 'EXCHANGE'
              ? 'exchange'
              : 'pass',
        // ASSUMPTION (EV): BOT-6 fallback = no word chosen. Exact for Beginner, the only playtest bot; Strategist
        // (S4) can exchange or pass by choice, so `BotDecision` must expose the flag before S4 ships.
        fallback: action.type !== 'PLACE_WORD',
        recomputed,
      },
    });
  }

  private wordProperties(
    breakdown: Extract<MatchModel['log'][number], { kind: 'word' }>['breakdown'],
    id: string,
    human: boolean,
    thinkMs: number,
    turn: number,
  ): EventProperties<'bot_word_played'> | null {
    const main = breakdown.words.find((w) => w.main);
    const ref = main === undefined ? undefined : this.lexicon.lookup(main.form);
    if (main === undefined || ref === undefined) return null;
    const category = this.lexicon.meta(this.lexicon.termOf(ref)).categories[0];
    if (!isCategory(category)) return null;
    const flags: BonusFlag[] = [];
    if (breakdown.words.some((w) => w.termBonus > 0)) flags.push('term');
    if (breakdown.fullStack > 0) flags.push('full_stack');
    if (breakdown.chain > 0) flags.push('chain');
    return {
      local_match_id: id,
      actor: human ? 'player' : 'bot',
      term_id: main.termId,
      form_kind: this.lexicon.formMeta(ref).kind,
      category,
      difficulty: main.difficulty,
      points: breakdown.total,
      bonus_flags: flags,
      think_ms: thinkMs,
      turn,
    };
  }

  private rejected(next: MatchModel, at: number): void {
    if (!this.on()) return;
    const open = this.ensureOpen(keyOf(next.state));
    open.rejected += 1;
    this.save();
    this.rejectedThisTurn += 1;
    if (this.rejectedThisTurn > MAX_REJECTED_EVENTS_PER_TURN) return;
    const main = livePreview(next)?.words.find((w) => w.main);
    const length = main?.form.length ?? next.pending.length;
    this.host.emit({
      event: 'word_rejected',
      properties: {
        local_match_id: open.id,
        reason: rejectedReason(next.rejectionCause ?? null),
        word_length: Math.min(15, Math.max(1, length)),
        think_ms: ms(this.turnBank + (this.turnSince === null ? 0 : at - this.turnSince)),
        turn: next.state.turnNumber,
      },
    });
  }

  private goLive(model: MatchModel, at: number): void {
    this.live = model.state.status === 'in_progress';
    this.segmentSince = this.live && this.foreground ? at : null;
    if (this.live && model.state.seatOnTurn === HUMAN_SEAT) this.startTurn(at);
    else this.stopTurn();
  }

  private endLive(at: number): void {
    this.pause(at);
    this.live = false;
    this.stopTurn();
  }

  /** Closes the running intervals (background, end): their time goes to the banks. */
  private pause(at: number): void {
    if (this.segmentSince !== null) this.activeBank += Math.max(0, at - this.segmentSince);
    this.segmentSince = null;
    if (this.turnSince !== null) this.turnBank += Math.max(0, at - this.turnSince);
    this.turnSince = null;
  }

  private startTurn(at: number): void {
    this.playerTurn = true;
    this.turnBank = 0;
    this.turnSince = this.foreground ? at : null;
    this.rejectedThisTurn = 0;
  }

  private stopTurn(): void {
    this.playerTurn = false;
    this.turnBank = 0;
    this.turnSince = null;
    this.rejectedThisTurn = 0;
  }

  private bankInto(open: OpenMatch): void {
    if (this.segmentSince !== null) {
      const at = this.now();
      this.activeBank += Math.max(0, at - this.segmentSince);
      this.segmentSince = at;
    }
    open.activeMs += Math.round(this.activeBank);
    this.activeBank = 0;
  }

  private on(): boolean {
    if (this.host.isRecording()) return true;
    // Consent off purges the record file: forget the copy in memory too.
    this.record = null;
    return false;
  }

  private load(): PlayRecord {
    this.record ??= parsePlayRecord(this.safeRead());
    return this.record;
  }

  private safeRead(): string | null {
    try {
      return this.host.readPlayRecord();
    } catch {
      return null;
    }
  }

  private save(): void {
    const record = this.record;
    if (record === null) return;
    try {
      this.host.writePlayRecord(JSON.stringify({ v: 1, ...record }));
    } catch {
      // Low storage: the memory copy wins for this process.
    }
  }

  private fresh(key: string): OpenMatch {
    return {
      id: this.host.newId(),
      key,
      activeMs: 0,
      rejected: 0,
      resumes: 0,
      turns: 0,
      lastWall: this.host.wallNow(),
      closed: false,
    };
  }

  /** The open record of the match with this key, adopted with a new id when it is missing or another match's. */
  private ensureOpen(key: string): OpenMatch {
    const record = this.load();
    if (record.open?.key === key) return record.open;
    record.open = this.fresh(key);
    return record.open;
  }
}
