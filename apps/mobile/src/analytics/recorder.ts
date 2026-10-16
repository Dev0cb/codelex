/**
 * The playtest recorder (E-1.5 AC-17, slice S6a), without React: the one object that decides whether anything is
 * recorded, builds the wire-form envelope, validates every event with the D1 schemas before it is queued, and owns
 * the session marker and the lifecycle events. Validation uses `event-guard.ts` (the zod-free mirror of the D1
 * schemas, tested equal to them): no zod in the app bundle. `analytics-provider.tsx` drives it from `AppState` and the first
 * route; the tests drive it directly.
 *
 * Gates, outermost first:
 * 1. `analytics.upload.enabled` (dark-launch flag, spec "Flags & rollout" SP2): off = no file is read or written, no
 *    event is recorded, every analytics surface is hidden. Constant for the process (bundled defaults only).
 * 2. Consent (AC-17, Q-7; default on): off = nothing recorded and everything purged (queue, install id, marker);
 *    the choice itself stays on disk (`consent.ts`).
 *
 * Session marker (`session-marker.ts` S6a contract): `start()` reads it, decides `previous_exit_unclean` and writes
 * it; the provider subscribes to `AppState` and, in the same tick, feeds `AppState.currentState` to `onAppState`;
 * the decision is held in memory and put on the first `app_opened` of the process, whenever that comes.
 *
 * "Send playtest data" (slice S6c): the export screen reads `exportSummary()` on open, builds the file on tap with
 * `prepareExport()` (zod-free `playtest-file.ts`, equal to the D1 contract), and after "Yes, I sent it" calls
 * `confirmSent()`, which clears exactly the events of that file and records `analytics_buffer_flushed`. The
 * end-of-session prompt (D-17) is `exportPromptDue()` / `markExportPromptShown()` (`export-prompt.ts`).
 *
 * "Would you play CODELEX again?" (slice S6b, AC-18): `noteSurveyMatchCompleted()`, `surveyDue()`,
 * `markSurveyShown()` and `answerSurvey()` (schedule in `survey.ts`). Shown and answered only while recording, so an
 * answer is never asked for when it could not be kept; the counters file is kept when consent is withdrawn (a UI
 * preference, like notice-seen), so the question is asked at most twice per install.
 *
 * Gameplay events (sprint 4 EV): the recorder is the `TelemetryHost` of `match/match-telemetry.ts` (recording state,
 * clocks, ids, the open-match record `analytics.play`) and records `onboarding_step_completed` itself
 * (`onboardingStep()`, steps kept in `analytics.onboarding`). Both files are purged with consent off.
 *
 * Every file lives in the shared backup-excluded data directory (`DATA_DIR`; threat model TM-03, R1-4) under the
 * names of {@link ANALYTICS_FILE_NAMES}. Nothing here throws: storage failures are absorbed (and visible as drop
 * counts or a later new install id), so analytics can never break play.
 */
import { DataStore, TMP_SUFFIX, type FsPrimitives } from '../persistence/data-store';
import { asciiJson } from '../persistence/match-journal';
import { CONSENT_FILE, readChoices, writeChoices, type AnalyticsChoices } from './consent';
import {
  EventQueue,
  QUEUE_FILE,
  QUEUE_FILES,
  type DroppedCounts,
  type QueueSummary,
} from './event-queue';
import { eventVersion, guardEvent, type GuardedEvent } from './event-guard';
import type { AnalyticsCall, AnalyticsEmitter } from './emitter';
import type { AnalyticsEvent, EventName, EventProperties, Platform } from './events';
import {
  INITIAL_PROMPT_SESSION,
  isPromptDue,
  stepPromptSession,
  type PromptSession,
} from './export-prompt';
import { ensureInstallId, INSTALL_ID_FILE } from './install-id';
import {
  buildPlaytestFile,
  PLAYTEST_FILE_FORMAT,
  PLAYTEST_FILE_KIND,
  type PlaytestFile,
} from './playtest-file';
import {
  INITIAL_LIFECYCLE,
  stepLifecycle,
  type LifecycleInput,
  type LifecycleState,
} from './lifecycle';
import {
  decideAtLaunch,
  onAppStateChange,
  SESSION_MARKER_FILE,
  type AppStateValue,
  type MarkerState,
} from './session-marker';
import {
  decodeSurveyState,
  encodeSurveyState,
  INITIAL_SURVEY,
  isSurveyDue,
  noteSurveyMatchCompleted,
  noteSurveyShown,
  SURVEY_FILE,
  SURVEY_ID,
  SURVEY_QUESTION_ID,
  SURVEY_UNREADABLE,
  type SurveyState,
} from './survey';

/** One tap on the survey card, or ✕ (`dismissed`). */
export type SurveyAnswer = EventProperties<'playtest_survey_answered'>['answer'];

/** Device-clock time the export prompt was last shown (D-17 24 h cool-down); purged with consent off. */
export const PROMPT_FILE = 'export.prompt';
/** The open match's analytics record (`match/match-telemetry.ts`, sprint 4 EV); purged with consent off. */
export const PLAY_FILE = 'analytics.play';
/** First-time-user steps done (`onboarding_step_completed`, sprint 4 EV); purged with consent off. */
export const ONBOARDING_FILE = 'analytics.onboarding';

/** Steps of `onboarding_step_completed` the app has (coach marks 1–3 do not exist yet: D-26, never emitted). */
export type OnboardingStep = EventProperties<'onboarding_step_completed'>['step'];
/** Steps the app reports; `first_launch` is the recorder's own (see `firstLaunch`). */
const ONBOARDING_STEPS: ReadonlySet<string> = new Set<OnboardingStep>([
  'home_seen',
  'play_now_tapped',
  'first_move',
  'first_match_completed',
]);

/** Every file the recorder owns in the data directory. */
export const ANALYTICS_FILE_NAMES: ReadonlySet<string> = new Set([
  ...QUEUE_FILES,
  INSTALL_ID_FILE,
  CONSENT_FILE,
  SESSION_MARKER_FILE,
  PROMPT_FILE,
  SURVEY_FILE,
  PLAY_FILE,
  ONBOARDING_FILE,
]);

const APP_STATES: ReadonlySet<string> = new Set<AppStateValue>([
  'active',
  'background',
  'inactive',
  'unknown',
  'extension',
]);

/** The marker's content does not matter (`session-marker.ts`): one constant byte. */
const MARKER_BYTES = Uint8Array.of(0x31);

/** Envelope fields that describe the build and the device locale (no device identifier, AC-17). */
export interface EnvelopeContext {
  readonly app_version: string;
  readonly platform: Platform;
  readonly locale: string;
}

/** Platform effects, injected so tests pin the disk, the ids and the clocks. */
export interface AnalyticsPlatform {
  /** The backup-excluded data directory (`createDeviceFs()` on the device). */
  readonly fs: FsPrimitives;
  /** A random UUID v4 (CSPRNG on the device): event ids, session id, install id. */
  readonly randomUUID: () => string;
  /** Device wall clock (ms since epoch): `occurred_at` and the 30-day expiry only. */
  readonly wallMs: () => number;
  /** Monotonic clock (ms): foreground intervals. */
  readonly monoMs: () => number;
  /** Ms since the process started: `cold_start_ms`. */
  readonly sinceProcessStartMs: () => number;
  readonly context: () => EnvelopeContext;
  /**
   * Deletes the share directory (`sharing/share-file.ts`, TM-04): consent withdrawal also removes a playtest file a
   * kill left there while the share sheet was open. May throw; the start-up sweep retries.
   */
  readonly sweepShareDirectory: () => void;
}

/** What the UI shows (Home notice, Settings "Playtest data"). */
export interface AnalyticsSnapshot {
  /** `analytics.upload.enabled`. */
  readonly enabled: boolean;
  readonly consent: boolean;
  /** The first-run notice is due (design §5.4, D-8). */
  readonly noticeVisible: boolean;
  /** Shown in Settings; null when recording is off. */
  readonly installId: string | null;
  /** Bumped when a confirmed export cleared events, so the "N waiting" counts are read again. */
  readonly exports: number;
}

const DISABLED: AnalyticsSnapshot = {
  enabled: false,
  consent: false,
  noticeVisible: false,
  installId: null,
  exports: 0,
};

/** The export screen's summary (design §5.9), read on open: counts only, no event parsed. */
export interface ExportSummary extends QueueSummary {
  readonly dropped: DroppedCounts;
}

/** What "Yes, I sent it" needs about the file that was shared (held by the screen, never written). */
export interface ExportTicket {
  readonly installId: string;
  /** Sequence number of the oldest event in the file. */
  readonly firstSeq: number;
  /** Sequence number of the newest event in the file. */
  readonly lastSeq: number;
  /** The file's `dropped` block. */
  readonly dropped: DroppedCounts;
  readonly eventsSent: number;
  /**
   * Queued events the file left out (the 1 MB cap: its `remaining`). What the screen says still waits after "Sent":
   * never the live queue count, which also holds what was recorded since (the flush event, the share sheet's
   * background/foreground on Android), and which a later export carries.
   */
  readonly remaining: number;
  readonly oldestMs: number;
  readonly exportedAtMs: number;
}

export type PreparedExport =
  | { readonly ok: true; readonly file: PlaytestFile; readonly ticket: ExportTicket }
  /** `off`: recording is off; `empty`: nothing queued; `invalid`: the file failed its contract (a bug). */
  | { readonly ok: false; readonly reason: 'off' | 'empty' | 'invalid' };

/** Also the app's {@link AnalyticsEmitter} (`emitter.ts`): features emit through `useAnalytics().emit(…)`. */
export class PlaytestAnalytics implements AnalyticsEmitter {
  private readonly store: DataStore;
  private readonly queue: EventQueue;
  private readonly sessionId: string;
  private started = false;
  private loaded = false;
  private choices: AnalyticsChoices = { consent: false, noticeSeen: true };
  private installId: string | null = null;
  /** Null while the marker is not maintained (flag off, consent off). */
  private marker: MarkerState | null = null;
  private previousExitUnclean = false;
  private appState: AppStateValue = 'unknown';
  private lifecycle: LifecycleState = INITIAL_LIFECYCLE;
  /** Validated events recorded before the queue loaded (`null` = an invalid one, counted at load). */
  private pending: (AnalyticsEvent | null)[] = [];
  /** Recorded before `start()` (dropped there if recording is off). */
  private beforeStart: {
    readonly name: EventName;
    readonly properties: unknown;
    readonly at: number;
  }[] = [];
  private snapshot: AnalyticsSnapshot = DISABLED;
  /** D-17 session state of the end-of-session export prompt (memory only). */
  private prompt: PromptSession = INITIAL_PROMPT_SESSION;
  /** S6b survey counters (`survey.ts`), read from disk on first use; memory wins if a write fails. */
  private survey: SurveyState | null = null;
  /** Confirmed exports this process (snapshot `exports`). */
  private exports = 0;
  /** Onboarding steps done; null = no first-time flow on this install; undefined = not read yet. */
  private onboarding: Set<string> | null | undefined = undefined;
  /** Monotonic time of the last onboarding step of this process (`duration_ms`). */
  private lastStepAt: number | null = null;
  /** Steps reported before `start()` (Home's mount effect runs before the provider's). */
  private stepsBeforeStart: OnboardingStep[] = [];
  /**
   * This launch is the install's first (clocks at `start()`): `first_launch` is recorded with that time just before
   * the next step, so a boot that never reaches Home leaves no file and no event behind.
   */
  private firstLaunch: { readonly wall: number; readonly mono: number } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly platform: AnalyticsPlatform,
    private readonly enabled: boolean,
  ) {
    this.store = new DataStore(platform.fs);
    this.queue = new EventQueue(this.store, platform.wallMs);
    this.sessionId = enabled ? platform.randomUUID() : '';
  }

  /** Process launch (contract step 1). Idempotent. */
  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.attempt(() => {
      this.store.recover((name) => ANALYTICS_FILE_NAMES.has(name));
    });
    this.choices = readChoices(this.store);
    if (this.choices.consent) {
      // A first launch: no consent choice and no install id on disk yet (a consent off/on keeps the choice file).
      const firstLaunch = this.absent([CONSENT_FILE, INSTALL_ID_FILE]);
      this.installId = ensureInstallId(this.store, this.platform.randomUUID);
      const launch = decideAtLaunch(this.markerOnDisk());
      this.previousExitUnclean = launch.previousExitUnclean;
      this.setMarker(launch.state);
      if (firstLaunch) {
        this.onboarding = new Set();
        this.firstLaunch = { wall: this.platform.wallMs(), mono: this.platform.monoMs() };
      }
      for (const step of this.stepsBeforeStart) this.onboardingStep(step);
    } else {
      // Also finishes a purge a kill interrupted.
      this.purgeFiles();
    }
    this.stepsBeforeStart = [];
    const held = this.beforeStart;
    this.beforeStart = [];
    for (const { name, properties, at } of held) this.build(name, properties, at);
    this.publish();
  }

  /** An `AppState` report: a change event, or the current state at subscription (contract step 2). */
  readonly onAppState = (reported: AppStateValue): void => {
    if (!this.enabled) return;
    // `currentState` can be null or another value before the native module answers: treat it as `unknown`.
    const next: AppStateValue = APP_STATES.has(reported) ? reported : 'unknown';
    this.appState = next;
    if (this.marker !== null) this.setMarker(onAppStateChange(this.marker, next));
    const at = this.platform.monoMs();
    this.prompt = stepPromptSession(this.prompt, { type: 'app_state', next, at });
    this.step({ type: 'app_state', next, at });
  };

  /** The first route rendered: the cold `app_opened` may fire. */
  markInteractive(): void {
    if (!this.enabled) return;
    this.step({ type: 'interactive', at: this.platform.monoMs() });
  }

  /** Loads the queue (deferred after the first render) and writes what was recorded before. Idempotent. */
  load(): void {
    if (!this.enabled || this.loaded) return;
    this.loaded = true;
    if (!this.recording()) return;
    const pending = this.pending;
    this.pending = [];
    for (const event of pending) {
      if (event === null) this.queue.countInvalid();
      else this.queue.append(event);
    }
  }

  /**
   * Records one event (the typed emitter): the recorder fills the envelope, validates the whole event, and queues
   * it, or drops and counts it as invalid (catalogue "Validation"). Nothing at all when recording is off.
   */
  record<N extends EventName>(name: N, properties: EventProperties<N>): void {
    this.recordAny(name, properties);
  }

  /** `AnalyticsEmitter.emit` (S5 seam): the same as {@link record}, for an event given as data. */
  readonly emit = (call: AnalyticsCall): void => {
    this.recordAny(call.event, call.properties);
  };

  private recordAny(name: EventName, properties: unknown): void {
    if (this.enabled && !this.started) {
      // Child components' mount effects run before the provider's: held until `start()` knows the consent.
      this.beforeStart.push({ name, properties, at: this.platform.wallMs() });
      return;
    }
    this.build(name, properties, this.platform.wallMs());
  }

  private build(name: EventName, properties: unknown, at: number): void {
    if (!this.recording()) return;
    let parsed: GuardedEvent;
    try {
      parsed = guardEvent({
        event: name,
        schema_version: eventVersion(name),
        event_id: this.platform.randomUUID(),
        occurred_at: new Date(at).toISOString(),
        user_id: this.installId,
        session_id: this.sessionId,
        ...this.platform.context(),
        properties,
      });
    } catch {
      parsed = { ok: false };
    }
    const event = parsed.ok ? parsed.event : null;
    if (!this.loaded) {
      this.pending.push(event);
    } else if (event === null) {
      this.queue.countInvalid();
    } else {
      this.queue.append(event);
    }
  }

  /**
   * The Settings toggle. Off: the choice is written first, then the queue, the install id and the marker are
   * deleted (a kill in between is finished at the next start). On: a new install id, an empty queue, the marker,
   * and a fresh foreground interval. False when the choice could not be saved (`settings.save_error`); then nothing
   * changed.
   */
  setConsent(on: boolean): boolean {
    if (!this.enabled) return false;
    if (on === this.choices.consent) return true;
    if (on) {
      // Nothing of the withdrawn pseudonym may survive into the new one (a leftover `install.id.tmp` would be
      // promoted by the next start's recovery): purge again and check before the new id is made.
      if (!this.purgeFiles() || !this.absent([INSTALL_ID_FILE, QUEUE_FILE])) {
        this.publish();
        return false;
      }
    }
    const choices = { ...this.choices, consent: on };
    if (!writeChoices(this.store, choices)) return false;
    this.choices = choices;
    let ok = true;
    if (on) {
      this.installId = ensureInstallId(this.store, this.platform.randomUUID);
      this.loaded = true;
      this.setMarker(onAppStateChange({ present: false, seenActive: true }, this.appState));
      this.step({ type: 'restart', at: this.platform.monoMs() });
    } else {
      // Recording stops now either way; a purge that could not delete everything is retried at the next start and
      // reported to the tester (`settings.save_error`).
      ok = this.purgeFiles();
    }
    this.publish();
    return ok;
  }

  /** The first-run notice was dismissed, or Home was left (design §5.4). */
  markNoticeSeen(): void {
    if (!this.enabled || this.choices.noticeSeen) return;
    const choices = { ...this.choices, noticeSeen: true };
    // Shown at most once per process even if it cannot be saved.
    writeChoices(this.store, choices);
    this.choices = choices;
    this.publish();
  }

  /** Events waiting in the queue ("N unsent events will be deleted"). */
  queuedCount(): number {
    if (!this.recording()) return 0;
    return this.loaded ? this.queue.size() : this.pending.filter((e) => e !== null).length;
  }

  /** Drop counts since the last confirmed export (export file `dropped`, slice S6c). */
  dropped(): DroppedCounts {
    return this.recording() ? this.queue.dropped() : { queueCap: 0, expired: 0, invalid: 0 };
  }

  // --- "Send playtest data" (slice S6c, design §5.9) -------------------------------------------------------------

  /** The export screen's summary; null when recording is off. Loads the queue if the idle load has not run yet. */
  exportSummary(): ExportSummary | null {
    if (!this.recording()) return null;
    this.load();
    return { ...this.queue.summary(), dropped: this.queue.dropped() };
  }

  /** "See an example event": the oldest queued event; null when there is none or recording is off. */
  exportSample(): AnalyticsEvent | null {
    if (!this.recording()) return null;
    this.load();
    return this.queue.sample();
  }

  /**
   * Builds the next file on tap (design §5.9: never on screen open): the oldest queued events that fit in 1 MB,
   * `remaining` for the rest, the drop counts since the last confirmed export, and the ticket "Yes, I sent it" needs.
   * Writes nothing and records nothing.
   *
   * @param build The store build number (`APP_BUILD`).
   */
  prepareExport(build: string): PreparedExport {
    const installId = this.installId;
    if (!this.recording() || installId === null) return { ok: false, reason: 'off' };
    this.load();
    const { events, seqs } = this.queue.exportable();
    const dropped = this.queue.dropped();
    const context = this.platform.context();
    const exportedAtMs = this.platform.wallMs();
    let exportedAt: string;
    try {
      exportedAt = new Date(exportedAtMs).toISOString();
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    const built = buildPlaytestFile(
      {
        exportFormat: PLAYTEST_FILE_FORMAT,
        kind: PLAYTEST_FILE_KIND,
        app: { version: context.app_version, build, platform: context.platform },
        installId,
        exportedAt,
        dropped,
      },
      events,
    );
    if (!built.ok) return { ok: false, reason: built.error.code === 'EMPTY' ? 'empty' : 'invalid' };
    const { included } = built.value;
    return {
      ok: true,
      file: built.value,
      ticket: {
        installId,
        firstSeq: seqs[0] ?? -1,
        lastSeq: seqs[included - 1] ?? -1,
        dropped,
        eventsSent: included,
        remaining: built.value.remaining,
        oldestMs: Date.parse(events[0]?.occurred_at ?? ''),
        exportedAtMs,
      },
    };
  }

  /**
   * "Yes, I sent it" (design §5.9): clears the events of the file and records `analytics_buffer_flushed` (catalogue;
   * it travels in the next file). True once the clear is on disk; false = "couldn't clear" (full disk), retried by
   * {@link retryClear}. If recording was turned off meanwhile, the purge already removed everything: true.
   */
  confirmSent(ticket: ExportTicket): boolean {
    if (!this.recording() || this.installId !== ticket.installId) return true;
    const cleared = this.queue.clearThrough(
      { firstSeq: ticket.firstSeq, lastSeq: ticket.lastSeq, events: ticket.eventsSent },
      ticket.dropped,
    );
    const { queueCap, expired, invalid } = ticket.dropped;
    const age = ticket.exportedAtMs - ticket.oldestMs;
    this.record('analytics_buffer_flushed', {
      events_sent: ticket.eventsSent,
      events_dropped_since_last: queueCap + expired + invalid,
      oldest_event_age_ms: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0,
    });
    this.exports += 1;
    this.publish();
    return cleared;
  }

  /** "Try again" after a clear that could not be saved. True once it is on disk. */
  retryClear(): boolean {
    if (!this.recording()) return true;
    return this.queue.flush();
  }

  /** A match reached its end this session (D-17 count); the match session calls it. */
  noteMatchCompleted(): void {
    if (!this.recording()) return;
    this.prompt = stepPromptSession(this.prompt, { type: 'match_completed' });
  }

  /** Matches completed this session (`export.prompt.body`). */
  sessionMatches(): number {
    return this.prompt.matches;
  }

  /** Home asks when it gains focus: the D-17 conditions hold now. */
  exportPromptDue(): boolean {
    if (!this.recording()) return false;
    return isPromptDue(this.prompt, {
      nowMono: this.platform.monoMs(),
      nowWall: this.platform.wallMs(),
      unsent: this.queuedCount(),
      lastShownWall: this.readPromptShown(),
    });
  }

  /** Home displayed the card: once per session, and the 24 h cool-down starts (kept on disk). */
  markExportPromptShown(): void {
    if (!this.recording()) return;
    this.prompt = stepPromptSession(this.prompt, { type: 'shown' });
    this.attempt(() => {
      this.store.replace(PROMPT_FILE, [asciiJson({ v: 1, shownAt: this.platform.wallMs() })]);
    });
  }

  // --- "Would you play CODELEX again?" (slice S6b, AC-18, design §5.6) -------------------------------------------

  /**
   * A match reached its end with `playtest.survey.enabled` on (the match session checks the flag). Counts only while
   * recording: the survey is never shown when its answer could not be recorded.
   */
  noteSurveyMatchCompleted(): void {
    if (!this.recording()) return;
    const before = this.surveyState();
    const next = noteSurveyMatchCompleted(before);
    if (next !== before) this.saveSurvey(next);
  }

  /** The Summary asks on mount: `matches_completed` when the card is due now, else null. */
  surveyDue(): number | null {
    if (!this.recording()) return null;
    const state = this.surveyState();
    return isSurveyDue(state) ? state.completed : null;
  }

  /**
   * The card is on screen: counts the showing (on disk) and records `playtest_survey_shown`. False, and nothing
   * recorded, when it was not due (a second call for the same Summary, recording off).
   */
  markSurveyShown(): boolean {
    if (!this.recording()) return false;
    const state = this.surveyState();
    if (!isSurveyDue(state)) return false;
    this.saveSurvey(noteSurveyShown(state));
    this.record('playtest_survey_shown', {
      survey_id: SURVEY_ID,
      question_id: SURVEY_QUESTION_ID,
      matches_completed: state.completed,
    });
    return true;
  }

  /** One tap on Yes / Maybe / No, or ✕ (`dismissed`). Validated by the event guard like every event. */
  answerSurvey(answer: SurveyAnswer, matchesCompleted: number): void {
    this.record('playtest_survey_answered', {
      survey_id: SURVEY_ID,
      question_id: SURVEY_QUESTION_ID,
      answer,
      matches_completed: matchesCompleted,
    });
  }

  private surveyState(): SurveyState {
    if (this.survey !== null) return this.survey;
    let state: SurveyState;
    try {
      const read = this.store.read(SURVEY_FILE, 256);
      if (read.kind === 'missing') state = INITIAL_SURVEY;
      else if (read.kind !== 'ok' || read.records.length !== 1) state = SURVEY_UNREADABLE;
      else state = decodeSurveyState(read.records[0] ?? '');
    } catch {
      state = SURVEY_UNREADABLE;
    }
    this.survey = state;
    return state;
  }

  private saveSurvey(state: SurveyState): void {
    this.survey = state;
    this.attempt(() => {
      this.store.replace(SURVEY_FILE, [encodeSurveyState(state)]);
    });
  }

  private readPromptShown(): number | null {
    try {
      const read = this.store.read(PROMPT_FILE, 128);
      if (read.kind !== 'ok' || read.records.length !== 1) return null;
      const parsed = JSON.parse(read.records[0] ?? '') as unknown;
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { v, shownAt } = parsed as Record<string, unknown>;
      return v === 1 && typeof shownAt === 'number' && Number.isFinite(shownAt) ? shownAt : null;
    } catch {
      return null;
    }
  }

  // --- Gameplay events (sprint 4 EV): the `TelemetryHost` of `match/match-telemetry.ts` ---------------------------

  /** Recording now: `analytics.upload.enabled`, consent on, started. */
  isRecording(): boolean {
    return this.recording();
  }

  /** The monotonic clock of the lifecycle events. */
  readonly monoNow = (): number => this.platform.monoMs();

  wallNow(): number {
    return this.platform.wallMs();
  }

  newId(): string {
    return this.platform.randomUUID();
  }

  /** The open-match record; null when absent, unreadable, or recording is off. */
  readPlayRecord(): string | null {
    if (!this.recording()) return null;
    try {
      const read = this.store.read(PLAY_FILE, 1024);
      return read.kind === 'ok' && read.records.length === 1 ? (read.records[0] ?? null) : null;
    } catch {
      return null;
    }
  }

  writePlayRecord(text: string): void {
    if (!this.recording()) return;
    this.attempt(() => {
      this.store.replace(PLAY_FILE, [text]);
    });
  }

  /**
   * A first-time-user step happened (design §11). Recorded once per install, only on an install whose first launch
   * was recorded (an install that played before this build, or enrolled with consent off, has no first-time flow).
   * `duration_ms`: since the previous step of this process, 0 for the first one (catalogue).
   */
  onboardingStep(step: OnboardingStep): void {
    if (this.enabled && !this.started) {
      this.stepsBeforeStart.push(step);
      return;
    }
    if (!this.recording() || !ONBOARDING_STEPS.has(step)) return;
    const done = this.onboardingDone();
    if (done === null || done.has(step)) return;
    const launch = this.firstLaunch;
    if (launch !== null) {
      this.firstLaunch = null;
      done.add('first_launch');
      this.lastStepAt = launch.mono;
      this.build(
        'onboarding_step_completed',
        { step: 'first_launch', duration_ms: 0 },
        launch.wall,
      );
    }
    done.add(step);
    this.attempt(() => {
      this.store.replace(ONBOARDING_FILE, [asciiJson({ v: 1, done: [...done] })]);
    });
    const at = this.platform.monoMs();
    const duration = this.lastStepAt === null ? 0 : Math.max(0, Math.round(at - this.lastStepAt));
    this.lastStepAt = at;
    this.record('onboarding_step_completed', { step, duration_ms: duration });
  }

  private onboardingDone(): Set<string> | null {
    if (this.onboarding !== undefined) return this.onboarding;
    let done: Set<string> | null = null;
    try {
      const read = this.store.read(ONBOARDING_FILE, 512);
      if (read.kind === 'ok' && read.records.length === 1) {
        const parsed = JSON.parse(read.records[0] ?? '') as unknown;
        const steps = (parsed as { v?: unknown; done?: unknown } | null)?.done;
        if ((parsed as { v?: unknown }).v === 1 && Array.isArray(steps)) {
          done = new Set(steps.filter((x): x is string => typeof x === 'string'));
        }
      }
    } catch {
      done = null;
    }
    this.onboarding = done;
    return done;
  }

  getSnapshot = (): AnalyticsSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private recording(): boolean {
    return this.enabled && this.started && this.choices.consent && this.installId !== null;
  }

  private step(input: LifecycleInput): void {
    const { state, emit } = stepLifecycle(this.lifecycle, input);
    this.lifecycle = state;
    for (const emission of emit) {
      if (emission.event === 'app_backgrounded') {
        this.record('app_backgrounded', { foreground_ms: emission.foregroundMs });
      } else if (emission.cold) {
        this.record('app_opened', {
          cold_start_ms: Math.max(0, Math.round(this.platform.sinceProcessStartMs())),
          network_type: 'unknown',
          previous_exit_unclean: this.previousExitUnclean,
        });
      } else {
        this.record('app_opened', { network_type: 'unknown' });
      }
    }
  }

  private markerOnDisk(): boolean {
    try {
      return this.platform.fs.size(SESSION_MARKER_FILE) !== null;
    } catch {
      return false;
    }
  }

  /** Writes or deletes the marker file whenever `present` changes. */
  private setMarker(next: MarkerState): void {
    const before = this.marker;
    this.marker = next;
    if (before !== null && before.present === next.present) return;
    this.attempt(() => {
      if (next.present) this.platform.fs.write(SESSION_MARKER_FILE, MARKER_BYTES);
      else this.platform.fs.remove(SESSION_MARKER_FILE);
    });
  }

  /**
   * Consent off: the queue, the install id and the marker are deleted, with any half-written temp file of every
   * analytics file (the choice file itself stays), and the share directory is swept (a playtest file left there by a
   * kill while the sheet was open). True when none of the analytics files is left on disk; a sweep that fails is
   * retried by the start-up sweep (`ShareSweep`).
   */
  private purgeFiles(): boolean {
    const queueGone = this.queue.purge();
    const names = [
      INSTALL_ID_FILE,
      SESSION_MARKER_FILE,
      PROMPT_FILE,
      PLAY_FILE,
      ONBOARDING_FILE,
      CONSENT_FILE,
    ].flatMap((name) => (name === CONSENT_FILE ? [name + TMP_SUFFIX] : [name, name + TMP_SUFFIX]));
    for (const name of names) {
      this.attempt(() => {
        this.platform.fs.remove(name);
      });
    }
    this.attempt(() => {
      this.platform.sweepShareDirectory();
    });
    this.installId = null;
    this.marker = null;
    this.onboarding = null;
    this.lastStepAt = null;
    this.firstLaunch = null;
    this.pending = [];
    this.beforeStart = [];
    this.loaded = true;
    return queueGone && this.absent(names);
  }

  private absent(names: readonly string[]): boolean {
    try {
      return names.every((name) => this.platform.fs.size(name) === null);
    } catch {
      return false;
    }
  }

  private publish(): void {
    this.snapshot = {
      enabled: this.enabled,
      consent: this.choices.consent,
      noticeVisible: !this.choices.noticeSeen,
      installId: this.installId,
      exports: this.exports,
    };
    for (const listener of this.listeners) listener();
  }

  private attempt(write: () => void): void {
    try {
      write();
    } catch {
      // Storage failure: see the module comment.
    }
  }
}
