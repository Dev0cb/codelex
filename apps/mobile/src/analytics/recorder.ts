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
 * Every file lives in the shared backup-excluded data directory (`DATA_DIR`; threat model TM-03, R1-4) under the
 * names of {@link ANALYTICS_FILE_NAMES}. Nothing here throws: storage failures are absorbed (and visible as drop
 * counts or a later new install id), so analytics can never break play.
 */
import { DataStore, type FsPrimitives } from '../persistence/data-store';
import { CONSENT_FILE, readChoices, writeChoices, type AnalyticsChoices } from './consent';
import { EventQueue, QUEUE_FILES, type DroppedCounts } from './event-queue';
import { eventVersion, guardEvent, type GuardedEvent } from './event-guard';
import type { AnalyticsCall, AnalyticsEmitter } from './emitter';
import type { AnalyticsEvent, EventName, EventProperties, Platform } from './events';
import { ensureInstallId, INSTALL_ID_FILE } from './install-id';
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

/** Every file the recorder owns in the data directory. */
export const ANALYTICS_FILE_NAMES: ReadonlySet<string> = new Set([
  ...QUEUE_FILES,
  INSTALL_ID_FILE,
  CONSENT_FILE,
  SESSION_MARKER_FILE,
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
}

const DISABLED: AnalyticsSnapshot = {
  enabled: false,
  consent: false,
  noticeVisible: false,
  installId: null,
};

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
      this.installId = ensureInstallId(this.store, this.platform.randomUUID);
      const launch = decideAtLaunch(this.markerOnDisk());
      this.previousExitUnclean = launch.previousExitUnclean;
      this.setMarker(launch.state);
    } else {
      // Also finishes a purge a kill interrupted.
      this.purgeFiles();
    }
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
    this.step({ type: 'app_state', next, at: this.platform.monoMs() });
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
    const choices = { ...this.choices, consent: on };
    if (!writeChoices(this.store, choices)) return false;
    this.choices = choices;
    if (on) {
      this.installId = ensureInstallId(this.store, this.platform.randomUUID);
      this.loaded = true;
      this.setMarker(onAppStateChange({ present: false, seenActive: true }, this.appState));
      this.step({ type: 'restart', at: this.platform.monoMs() });
    } else {
      this.purgeFiles();
    }
    this.publish();
    return true;
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
    return this.queue.dropped();
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

  /** Consent off: queue, install id and marker deleted; the choice file stays. */
  private purgeFiles(): void {
    this.queue.purge();
    for (const name of [INSTALL_ID_FILE, SESSION_MARKER_FILE]) {
      this.attempt(() => {
        this.platform.fs.remove(name);
      });
    }
    this.installId = null;
    this.marker = null;
    this.pending = [];
    this.loaded = true;
  }

  private publish(): void {
    this.snapshot = {
      enabled: this.enabled,
      consent: this.choices.consent,
      noticeVisible: !this.choices.noticeSeen,
      installId: this.installId,
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
