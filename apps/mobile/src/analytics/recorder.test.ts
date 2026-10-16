/**
 * The playtest recorder (E-1.5 AC-17, slice S6a): dark-launch flag, consent, purge, install id, the session-marker
 * contract of `session-marker.ts` (`previous_exit_unclean`) and `app_backgrounded.foreground_ms`, validation of every
 * event before it is queued. Processes are simulated on an in-memory disk: `fs.reboot()` is the next cold start.
 */
import { describe, expect, it } from '@jest/globals';

import { DataStore, TMP_SUFFIX } from '../persistence/data-store';
import { MemoryFs } from '../persistence/memory-fs';
import { CONSENT_FILE } from './consent';
import { EventQueue, QUEUE_FILE, QUEUE_MAX_AGE_MS, QUEUE_META_FILE } from './event-queue';
import type { AnalyticsEvent, EventProperties } from './events';
import { INSTALL_ID_FILE, isUuidV4 } from './install-id';
import {
  ANALYTICS_FILE_NAMES,
  PlaytestAnalytics,
  PROMPT_FILE,
  type AnalyticsPlatform,
} from './recorder';
import { decodePlaytestExport } from '../export/playtest-data';
import { SESSION_MARKER_FILE } from './session-marker';
import { SURVEY_FILE, SURVEY_ID } from './survey';
import { eventId } from './test-support';

const T0 = Date.parse('2026-10-07T09:30:00.000Z');

interface Harness {
  readonly fs: MemoryFs;
  readonly analytics: PlaytestAnalytics;
  readonly clock: { wall: number; mono: number; sinceStart: number };
  /** Share-directory sweeps the recorder asked for; `fail` makes the next ones throw. */
  readonly share: { sweeps: number; fail: boolean };
}

let uuidCounter = 0;
const newUuid = (): string => {
  uuidCounter += 1;
  return eventId(uuidCounter);
};

function boot(fs: MemoryFs, enabled = true, wall = T0): Harness {
  const clock = { wall, mono: 0, sinceStart: 1840 };
  const share = { sweeps: 0, fail: false };
  const platform: AnalyticsPlatform = {
    fs,
    randomUUID: newUuid,
    wallMs: () => clock.wall,
    monoMs: () => clock.mono,
    sinceProcessStartMs: () => clock.sinceStart,
    context: () => ({ app_version: '0.1.0', platform: 'android', locale: 'fr-SN' }),
    sweepShareDirectory: () => {
      share.sweeps += 1;
      if (share.fail) throw new Error('EBUSY');
    },
  };
  return { fs, analytics: new PlaytestAnalytics(platform, enabled), clock, share };
}

/** The provider's sequence at mount: launch, subscribe and feed the current state, deferred queue load. */
function launch(h: Harness, current: 'active' | 'background' = 'active'): Harness {
  h.analytics.start();
  h.analytics.onAppState(current);
  h.analytics.load();
  return h;
}

const queued = (fs: MemoryFs): readonly AnalyticsEvent[] =>
  new EventQueue(new DataStore(fs.reboot()), () => T0).events();

const names = (fs: MemoryFs): string[] => queued(fs).map((e) => e.event);

const propsOf = (e: AnalyticsEvent | undefined): unknown => e?.properties;

describe('PlaytestAnalytics: dark launch (analytics.upload.enabled off)', () => {
  it('touches no file, records nothing and hides every analytics surface', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs, false));
    h.analytics.markInteractive();
    h.analytics.record('app_backgrounded', { foreground_ms: 5 });
    h.analytics.onAppState('background');
    expect(h.analytics.setConsent(false)).toBe(false);
    h.analytics.markNoticeSeen();
    expect(h.analytics.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
    // S6c surfaces are inert too.
    h.analytics.noteMatchCompleted();
    h.analytics.markExportPromptShown();
    expect(h.analytics.exportPromptDue()).toBe(false);
    expect(h.analytics.exportSummary()).toBeNull();
    expect(h.analytics.exportSample()).toBeNull();
    expect(h.analytics.prepareExport('1')).toEqual({ ok: false, reason: 'off' });
    expect(h.analytics.retryClear()).toBe(true);
    expect(fs.boundaries).toBe(0);
    expect(fs.reads).toEqual([]);
    expect(h.analytics.getSnapshot()).toEqual({
      enabled: false,
      consent: false,
      noticeVisible: false,
      installId: null,
      exports: 0,
    });
    expect(h.analytics.queuedCount()).toBe(0);
  });
});

describe('PlaytestAnalytics: first launch with consent on (Q-7 default)', () => {
  it('creates an install id, writes the session marker and shows the notice', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    const snapshot = h.analytics.getSnapshot();
    expect(snapshot).toMatchObject({ enabled: true, consent: true, noticeVisible: true });
    expect(isUuidV4(snapshot.installId ?? '')).toBe(true);
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
    expect(fs.files.has(INSTALL_ID_FILE)).toBe(true);
  });

  it('records the cold app_opened once interactive, with the launch fields (D1 contract)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    expect(names(fs)).toEqual([]);
    h.clock.sinceStart = 2210.6;
    h.analytics.markInteractive();
    const [opened] = queued(fs);
    expect(opened).toMatchObject({
      event: 'app_opened',
      schema_version: 2,
      user_id: h.analytics.getSnapshot().installId,
      app_version: '0.1.0',
      platform: 'android',
      locale: 'fr-SN',
      occurred_at: '2026-10-07T09:30:00.000Z',
    });
    expect(propsOf(opened)).toEqual({
      cold_start_ms: 2211,
      network_type: 'unknown',
      previous_exit_unclean: false,
    });
  });

  it('measures foreground_ms on the monotonic clock and emits warm app_opened on return', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    h.clock.mono = 480_000;
    h.clock.wall = T0 - 3_600_000; // the device clock jumped back: foreground_ms does not care
    h.analytics.onAppState('background');
    h.clock.mono = 500_000;
    h.analytics.onAppState('active');
    expect(queued(fs).map((e) => [e.event, e.properties])).toEqual([
      [
        'app_opened',
        { cold_start_ms: 1840, network_type: 'unknown', previous_exit_unclean: false },
      ],
      ['app_backgrounded', { foreground_ms: 480_000 }],
      ['app_opened', { network_type: 'unknown' }],
    ]);
  });

  it('gives every event a distinct event_id and one session_id per process', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    h.analytics.onAppState('background');
    const first = queued(fs);
    const next = launch(boot(fs.reboot()));
    next.analytics.markInteractive();
    const all = queued(next.fs);
    expect(new Set(all.map((e) => e.event_id)).size).toBe(all.length);
    expect(first[0]?.session_id).toBe(first[1]?.session_id);
    expect(all[2]?.session_id).not.toBe(all[0]?.session_id);
    expect(new Set(all.map((e) => e.user_id)).size).toBe(1);
  });
});

describe('PlaytestAnalytics: previous_exit_unclean (session-marker.ts S6a contract)', () => {
  const coldFlag = (fs: MemoryFs): unknown => {
    const opened = queued(fs).filter((e) => e.event === 'app_opened');
    const last = opened.at(-1);
    return last?.event === 'app_opened' ? last.properties.previous_exit_unclean : 'none';
  };

  it('is true after a process that died in the foreground, false after a background exit', () => {
    let fs = new MemoryFs();
    const crashed = launch(boot(fs));
    crashed.analytics.markInteractive();
    // The process dies while active: the marker stays on disk.
    fs = fs.reboot();
    const second = launch(boot(fs));
    second.analytics.markInteractive();
    expect(coldFlag(fs)).toBe(true);
    second.analytics.onAppState('background');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(false);
    // Killed by the OS in the background: a clean exit.
    fs = fs.reboot();
    const third = launch(boot(fs));
    third.analytics.markInteractive();
    expect(coldFlag(fs)).toBe(false);
  });

  it('holds the launch decision until the first app_opened, even after a background trip', () => {
    let fs = new MemoryFs();
    launch(boot(fs)); // dies during start-up, before any route rendered
    fs = fs.reboot();
    const h = launch(boot(fs));
    h.analytics.onAppState('background');
    h.analytics.onAppState('active');
    h.analytics.markInteractive();
    expect(names(fs)).toEqual(['app_backgrounded', 'app_opened']);
    expect(coldFlag(fs)).toBe(true);
  });

  it('feeds the state current at subscription: a launch in the background does not keep the marker', () => {
    const fs = new MemoryFs();
    launch(boot(fs), 'background');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(false);
  });

  it('keeps the marker through iOS inactive during launch, removes it on inactive after use', () => {
    const fs = new MemoryFs();
    const h = boot(fs);
    h.analytics.start();
    h.analytics.onAppState('inactive');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
    h.analytics.onAppState('active');
    h.analytics.onAppState('inactive');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(false);
    h.analytics.onAppState('active');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
  });

  it('treats an unexpected AppState value as unknown (before the native module answers)', () => {
    const fs = new MemoryFs();
    const h = boot(fs);
    h.analytics.start();
    h.analytics.onAppState(null as unknown as 'active');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
    h.analytics.onAppState('background');
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(false);
  });

  it('starts once per process', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    const boundaries = fs.boundaries;
    h.analytics.start();
    expect(fs.boundaries).toBe(boundaries);
  });
});

describe('PlaytestAnalytics: recording', () => {
  it('validates every event with the D1 schemas: an invalid one is dropped and counted', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: -1 });
    h.analytics.record('word_rejected', {
      local_match_id: 'not-a-uuid',
      reason: 'placement',
      word_length: 3,
      think_ms: 1,
      turn: 1,
    });
    h.analytics.record('bot_word_played', {
      foreground_ms: 3,
    } as unknown as EventProperties<'bot_word_played'>);
    h.analytics.record('app_backgrounded', { foreground_ms: 7 });
    expect(names(fs)).toEqual(['app_backgrounded']);
    expect(new EventQueue(new DataStore(fs.reboot()), () => T0).dropped().invalid).toBe(3);
  });

  it('holds events recorded before start and keeps them only with consent', () => {
    const fs = new MemoryFs();
    const h = boot(fs);
    h.analytics.record('app_backgrounded', { foreground_ms: 3 });
    launch(h);
    expect(queued(fs).map((e) => propsOf(e))).toEqual([{ foreground_ms: 3 }]);
    h.analytics.setConsent(false);
    const next = boot(fs.reboot());
    next.analytics.record('app_backgrounded', { foreground_ms: 4 });
    launch(next);
    expect([...next.fs.files.keys()]).toEqual([CONSENT_FILE]);
  });

  it('keeps events recorded before the queue loaded, in order', () => {
    const fs = new MemoryFs();
    const h = boot(fs);
    h.analytics.start();
    h.analytics.onAppState('active');
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    h.analytics.record('app_backgrounded', { foreground_ms: -1 });
    h.analytics.record('app_backgrounded', { foreground_ms: 2 });
    expect(h.analytics.queuedCount()).toBe(2);
    expect(fs.files.has(QUEUE_FILE)).toBe(false);
    h.analytics.load();
    h.analytics.load();
    expect(queued(fs).map((e) => propsOf(e))).toEqual([{ foreground_ms: 1 }, { foreground_ms: 2 }]);
    expect(new EventQueue(new DataStore(fs.reboot()), () => T0).dropped().invalid).toBe(1);
  });

  it('keeps the queue across process kills and expires events after 30 days at load', () => {
    let fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    fs = fs.reboot();
    const next = launch(boot(fs, true, T0 + 1000));
    expect(next.analytics.queuedCount()).toBe(1);
    fs = fs.reboot();
    const later = launch(boot(fs, true, T0 + QUEUE_MAX_AGE_MS + 1));
    expect(later.analytics.queuedCount()).toBe(0);
    expect(later.analytics.dropped().expired).toBe(1);
  });

  it('survives a full disk: recording never throws', () => {
    const fs = new MemoryFs();
    fs.fullAfter = 0;
    const h = launch(boot(fs));
    expect(() => {
      h.analytics.markInteractive();
      h.analytics.record('app_backgrounded', { foreground_ms: 1 });
      h.analytics.onAppState('background');
    }).not.toThrow();
    expect(h.analytics.queuedCount()).toBe(3);
  });

  it('counts an event it cannot even build as invalid (a broken clock)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.clock.wall = Number.NaN;
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    expect(h.analytics.queuedCount()).toBe(0);
    expect(h.analytics.dropped().invalid).toBe(1);
  });
});

describe('PlaytestAnalytics: consent (AC-17, design §5.8)', () => {
  it('purges the queue, the install id and the marker when consent is withdrawn', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    expect(h.analytics.queuedCount()).toBe(2);
    expect(h.share.sweeps).toBe(0);
    let notified = 0;
    const unsubscribe = h.analytics.subscribe(() => {
      notified += 1;
    });
    expect(h.analytics.setConsent(false)).toBe(true);
    unsubscribe();
    expect(notified).toBe(1);
    // A playtest file left in the share directory (a kill while the sheet was open) goes too (TM-04).
    expect(h.share.sweeps).toBe(1);
    expect(h.analytics.getSnapshot()).toMatchObject({ consent: false, installId: null });
    expect([...fs.files.keys()]).toEqual([CONSENT_FILE]);
    // Nothing is recorded any more, including lifecycle events and the setting change itself.
    h.analytics.record('app_backgrounded', { foreground_ms: 2 });
    h.analytics.onAppState('background');
    h.analytics.onAppState('active');
    expect([...fs.files.keys()]).toEqual([CONSENT_FILE]);
    expect(h.analytics.queuedCount()).toBe(0);
    expect(h.analytics.setConsent(false)).toBe(true);
  });

  it('withdraws consent even when the share directory cannot be swept (retried at the next start)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    h.share.fail = true;
    expect(h.analytics.setConsent(false)).toBe(true);
    expect(h.share.sweeps).toBe(1);
    expect([...fs.files.keys()]).toEqual([CONSENT_FILE]);
    const next = boot(fs.reboot());
    launch(next);
    expect(next.share.sweeps).toBe(1);
  });

  it('stays off at the next start: no marker, no id, nothing recorded', () => {
    const fs = new MemoryFs();
    launch(boot(fs)).analytics.setConsent(false);
    const next = launch(boot(fs.reboot()));
    next.analytics.markInteractive();
    next.analytics.onAppState('background');
    expect([...next.fs.files.keys()]).toEqual([CONSENT_FILE]);
    expect(next.analytics.getSnapshot()).toMatchObject({ consent: false, installId: null });
  });

  it('finishes an interrupted purge at the next start', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    // Killed right after the choice was written, before the files were removed.
    new DataStore(fs).replace(CONSENT_FILE, ['{"v":1,"consent":false,"noticeSeen":true}']);
    const next = launch(boot(fs.reboot()));
    expect([...next.fs.files.keys()].sort()).toEqual([CONSENT_FILE]);
  });

  it('generates a new install id when consent is turned back on, and records from then on', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    const before = h.analytics.getSnapshot().installId;
    h.analytics.setConsent(false);
    h.clock.mono = 1000;
    expect(h.analytics.setConsent(true)).toBe(true);
    const after = h.analytics.getSnapshot().installId;
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
    h.clock.mono = 1600;
    h.analytics.onAppState('background');
    const events = queued(fs);
    // Foreground time before consent is not measured.
    expect(events.map((e) => [e.event, e.user_id, e.properties])).toEqual([
      ['app_backgrounded', after, { foreground_ms: 600 }],
    ]);
  });

  it('leaves no temp file of the old pseudonym behind a withdrawal and a re-consent (review minor 1)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    const before = h.analytics.getSnapshot().installId ?? '';
    fs.files.set(QUEUE_FILE + TMP_SUFFIX, fs.files.get(QUEUE_FILE) ?? new Uint8Array(0));
    new DataStore(fs).replace(`${INSTALL_ID_FILE}-x`, [before]);
    fs.files.set(
      INSTALL_ID_FILE + TMP_SUFFIX,
      fs.files.get(`${INSTALL_ID_FILE}-x`) ?? new Uint8Array(0),
    );
    fs.files.delete(`${INSTALL_ID_FILE}-x`);
    expect(h.analytics.setConsent(false)).toBe(true);
    expect([...fs.files.keys()]).toEqual([CONSENT_FILE]);
    expect(h.analytics.setConsent(true)).toBe(true);
    const next = launch(boot(fs.reboot()));
    expect(next.analytics.queuedCount()).toBe(0);
    expect(next.analytics.getSnapshot().installId).not.toBe(before);
    expect(next.analytics.getSnapshot().installId).toBe(h.analytics.getSnapshot().installId);
  });

  it('refuses to re-consent while files of the old pseudonym cannot be deleted', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.setConsent(false);
    fs.files.set(INSTALL_ID_FILE, Uint8Array.of(1));
    const stuck = fs.remove.bind(fs);
    fs.remove = (name: string): void => {
      if (name === INSTALL_ID_FILE) throw new Error('EACCES');
      stuck(name);
    };
    expect(h.analytics.setConsent(true)).toBe(false);
    expect(h.analytics.getSnapshot()).toMatchObject({ consent: false, installId: null });
  });

  it('changes nothing when the choice cannot be saved (settings.save_error)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.record('app_backgrounded', { foreground_ms: 1 });
    fs.fullAfter = 0;
    expect(h.analytics.setConsent(false)).toBe(false);
    expect(h.analytics.getSnapshot().consent).toBe(true);
    expect(h.analytics.queuedCount()).toBe(1);
  });

  it('records nothing when the stored choice is unreadable (privacy-first fallback)', () => {
    const fs = new MemoryFs();
    new DataStore(fs).replace(CONSENT_FILE, ['{"v":1,"consent":"yes"}']);
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    expect(h.analytics.getSnapshot()).toMatchObject({ consent: false, noticeVisible: false });
    expect(fs.files.has(QUEUE_FILE)).toBe(false);
  });

  it('hides the notice for good once seen', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markNoticeSeen();
    h.analytics.markNoticeSeen();
    expect(h.analytics.getSnapshot().noticeVisible).toBe(false);
    expect(launch(boot(fs.reboot())).analytics.getSnapshot().noticeVisible).toBe(false);
  });

  it('keeps every file it owns in the shared data directory under a known name (R1-4)', () => {
    const fs = new MemoryFs();
    const h = launch(boot(fs));
    h.analytics.markInteractive();
    h.analytics.markNoticeSeen();
    for (let n = 0; n < 3; n += 1) h.analytics.record('app_backgrounded', { foreground_ms: n });
    h.analytics.record('app_backgrounded', { foreground_ms: -1 }); // invalid: writes the meta file
    h.analytics.markExportPromptShown();
    h.analytics.noteSurveyMatchCompleted();
    const owned = [
      CONSENT_FILE,
      INSTALL_ID_FILE,
      QUEUE_FILE,
      QUEUE_META_FILE,
      SESSION_MARKER_FILE,
      PROMPT_FILE,
      SURVEY_FILE,
    ];
    expect([...fs.files.keys()].sort()).toEqual([...owned].sort());
    expect([...ANALYTICS_FILE_NAMES].sort()).toEqual([...owned].sort());
  });
});

describe('PlaytestAnalytics: Send playtest data (slice S6c, design §5.9)', () => {
  const MIN = 60 * 1000;

  /** A recording install with `n` `app_backgrounded` events (plus the cold `app_opened`). */
  function withEvents(n: number): Harness {
    const h = launch(boot(new MemoryFs()));
    h.analytics.markInteractive();
    for (let i = 0; i < n; i += 1) h.analytics.record('app_backgrounded', { foreground_ms: i });
    return h;
  }

  const prepared = (h: Harness) => {
    const result = h.analytics.prepareExport('42');
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it('summarises the queue on open without building the file', () => {
    const h = withEvents(3);
    const writes = h.fs.writes.length;
    expect(h.analytics.exportSummary()).toEqual({
      events: 4,
      matches: 0,
      oldestMs: T0,
      newestMs: T0,
      dropped: { queueCap: 0, expired: 0, invalid: 0 },
    });
    expect(h.analytics.exportSample()?.event).toBe('app_opened');
    expect(h.fs.writes.length).toBe(writes);
  });

  it('builds an exportFormat 1 file with the install id, build and drop counts, and writes nothing', () => {
    const h = withEvents(2);
    h.analytics.record('app_backgrounded', { foreground_ms: -1 }); // counted invalid
    h.clock.wall = T0 + 5000;
    const writes = h.fs.writes.length;
    const { file, ticket } = prepared(h);
    expect(h.fs.writes.length).toBe(writes);
    const parsed = JSON.parse(file.text) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      exportFormat: 1,
      kind: 'codelex.playtest_data',
      app: { version: '0.1.0', build: '42', platform: 'android' },
      installId: h.analytics.getSnapshot().installId,
      exportedAt: new Date(T0 + 5000).toISOString(),
      dropped: { queueCap: 0, expired: 0, invalid: 1 },
      remaining: 0,
    });
    expect((parsed['events'] as unknown[]).length).toBe(3);
    expect(file).toMatchObject({ included: 3, remaining: 0 });
    expect(ticket).toMatchObject({
      eventsSent: 3,
      remaining: 0,
      oldestMs: T0,
      exportedAtMs: T0 + 5000,
    });
  });

  it('refuses an empty queue and an invalid file (a bad build number)', () => {
    const h = launch(boot(new MemoryFs()));
    expect(h.analytics.prepareExport('42')).toEqual({ ok: false, reason: 'empty' });
    h.analytics.markInteractive();
    expect(h.analytics.prepareExport('b42')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('"Yes, I sent it" clears exactly the file and records analytics_buffer_flushed', () => {
    const h = withEvents(2);
    const { ticket } = prepared(h);
    // Recorded while the share sheet was open: stays queued.
    h.analytics.record('app_backgrounded', { foreground_ms: 99 });
    h.clock.wall = T0 + 60_000;
    let notified = 0;
    h.analytics.subscribe(() => {
      notified += 1;
    });
    expect(h.analytics.confirmSent(ticket)).toBe(true);
    expect(notified).toBe(1);
    expect(h.analytics.getSnapshot().exports).toBe(1);
    const left = queued(h.fs);
    expect(left.map((e) => e.event)).toEqual(['app_backgrounded', 'analytics_buffer_flushed']);
    expect(propsOf(left[0])).toEqual({ foreground_ms: 99 });
    expect(propsOf(left[1])).toEqual({
      events_sent: 3,
      events_dropped_since_last: 0,
      oldest_event_age_ms: 0,
    });
    expect(h.analytics.queuedCount()).toBe(2);
  });

  it('reports the age of the oldest event and the drops the file carried', () => {
    const h = withEvents(1);
    h.analytics.record('app_backgrounded', { foreground_ms: -1 });
    h.clock.wall = T0 + 90_000;
    const { ticket } = prepared(h);
    h.analytics.confirmSent(ticket);
    expect(propsOf(queued(h.fs).at(-1))).toEqual({
      events_sent: 2,
      events_dropped_since_last: 1,
      oldest_event_age_ms: 90_000,
    });
    expect(h.analytics.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
  });

  it('shares a full queue in several files under 1 MB, with remaining, round after round', () => {
    const h = withEvents(4999);
    expect(h.analytics.queuedCount()).toBe(5000);
    let rounds = 0;
    let sent = 0;
    for (;;) {
      const result = h.analytics.prepareExport('42');
      if (!result.ok) break;
      const { file, ticket } = result;
      expect(file.text.length).toBeLessThanOrEqual(1_000_000);
      sent += file.included;
      rounds += 1;
      // The ticket carries what the file left out: the screen's "N still waiting" (never the live count).
      expect(ticket.remaining).toBe(file.remaining);
      expect(h.analytics.confirmSent(ticket)).toBe(true);
      // Only the analytics_buffer_flushed events of the confirmed rounds are left at the end.
      if (file.remaining === 0) break;
      expect(h.analytics.queuedCount()).toBe(file.remaining + rounds);
    }
    expect(rounds).toBeGreaterThanOrEqual(2);
    expect(sent).toBeGreaterThanOrEqual(5000);
    expect(queued(h.fs).every((e) => e.event === 'analytics_buffer_flushed')).toBe(true);
  });

  it('reports a clear that hit a full disk; retryClear saves it later', () => {
    const h = withEvents(2);
    const { ticket } = prepared(h);
    h.fs.fullAfter = 0;
    expect(h.analytics.confirmSent(ticket)).toBe(false);
    expect(h.analytics.retryClear()).toBe(false);
    h.fs.fullAfter = null;
    expect(h.analytics.retryClear()).toBe(true);
    expect(queued(h.fs).map((e) => e.event)).toEqual(['analytics_buffer_flushed']);
  });

  it('confirming after consent was withdrawn clears nothing more and records nothing', () => {
    const h = withEvents(2);
    const { ticket } = prepared(h);
    h.analytics.setConsent(false);
    expect(h.analytics.confirmSent(ticket)).toBe(true);
    expect([...h.fs.files.keys()]).toEqual([CONSENT_FILE]);
    expect(h.analytics.retryClear()).toBe(true);
  });

  it('ignores a ticket of a previous pseudonym', () => {
    const h = withEvents(2);
    const { ticket } = prepared(h);
    h.analytics.setConsent(false);
    h.analytics.setConsent(true);
    h.analytics.record('app_backgrounded', { foreground_ms: 7 });
    expect(h.analytics.confirmSent(ticket)).toBe(true);
    expect(h.analytics.queuedCount()).toBe(1);
  });

  it('end-of-session prompt: due after two matches with unsent events, once per session, 24 h cool-down', () => {
    const fs = new MemoryFs();
    const h = withEvents(1);
    expect(h.analytics.exportPromptDue()).toBe(false);
    h.analytics.noteMatchCompleted();
    expect(h.analytics.exportPromptDue()).toBe(false);
    h.clock.mono = 8 * MIN;
    expect(h.analytics.exportPromptDue()).toBe(true);
    h.analytics.noteMatchCompleted();
    expect(h.analytics.sessionMatches()).toBe(2);
    h.analytics.markExportPromptShown();
    expect(h.analytics.exportPromptDue()).toBe(false);
    // A new process (new session) within 24 h: still held back by the cool-down on disk.
    for (const [name, bytes] of h.fs.files) fs.files.set(name, bytes);
    const next = launch(boot(fs.reboot(), true, T0 + 60 * MIN));
    next.analytics.noteMatchCompleted();
    next.analytics.noteMatchCompleted();
    expect(next.analytics.exportPromptDue()).toBe(false);
    next.clock.wall = T0 + 25 * 60 * MIN;
    expect(next.analytics.exportPromptDue()).toBe(true);
  });

  it('reads an unreadable prompt file as never shown', () => {
    const h = withEvents(1);
    new DataStore(h.fs).replace(PROMPT_FILE, ['{"v":2}']);
    h.analytics.noteMatchCompleted();
    h.analytics.noteMatchCompleted();
    expect(h.analytics.exportPromptDue()).toBe(true);
    h.fs.files.set(PROMPT_FILE, Uint8Array.of(0xff));
    expect(h.analytics.exportPromptDue()).toBe(true);
  });

  it('purges the prompt file with consent off', () => {
    const h = withEvents(1);
    h.analytics.markExportPromptShown();
    expect(h.fs.files.has(PROMPT_FILE)).toBe(true);
    h.analytics.setConsent(false);
    expect([...h.fs.files.keys()]).toEqual([CONSENT_FILE]);
  });
});

describe('PlaytestAnalytics: "Would you play CODELEX again?" survey (slice S6b, AC-18)', () => {
  /** A recording install whose queue holds only what the test records. */
  const recording = (fs = new MemoryFs()): Harness => launch(boot(fs));

  /** Completes `n` matches with the survey active, showing the card when due; returns where it was shown. */
  function complete(h: Harness, n: number): number[] {
    const at: number[] = [];
    for (let i = 0; i < n; i += 1) {
      h.analytics.noteSurveyMatchCompleted();
      const due = h.analytics.surveyDue();
      if (due !== null && h.analytics.markSurveyShown()) at.push(due);
    }
    return at;
  }

  const surveyEvents = (fs: MemoryFs): string[] =>
    names(fs).filter((n) => n.startsWith('playtest_survey'));

  it('is due on the 1st and 3rd completed match, and records playtest_survey_shown each time', () => {
    const h = recording();
    expect(h.analytics.surveyDue()).toBeNull();
    expect(complete(h, 5)).toEqual([1, 3]);
    const shown = queued(h.fs).filter((e) => e.event === 'playtest_survey_shown');
    expect(shown.map(propsOf)).toEqual([
      { survey_id: SURVEY_ID, question_id: 'would_play_again', matches_completed: 1 },
      { survey_id: SURVEY_ID, question_id: 'would_play_again', matches_completed: 3 },
    ]);
  });

  it('records each answer, a dismissal included, through the event guard', () => {
    const h = recording();
    complete(h, 1);
    h.analytics.answerSurvey('maybe', 1);
    h.analytics.answerSurvey('dismissed', 1);
    // Not a catalogue value: dropped and counted, never queued.
    h.analytics.answerSurvey('perhaps' as 'maybe', 1);
    const answers = queued(h.fs).filter((e) => e.event === 'playtest_survey_answered');
    expect(answers.map(propsOf)).toEqual([
      {
        survey_id: SURVEY_ID,
        question_id: 'would_play_again',
        answer: 'maybe',
        matches_completed: 1,
      },
      {
        survey_id: SURVEY_ID,
        question_id: 'would_play_again',
        answer: 'dismissed',
        matches_completed: 1,
      },
    ]);
    expect(h.analytics.dropped().invalid).toBe(1);
  });

  it('shows at most once per completion: a second markSurveyShown records nothing', () => {
    const h = recording();
    h.analytics.noteSurveyMatchCompleted();
    expect(h.analytics.markSurveyShown()).toBe(true);
    expect(h.analytics.surveyDue()).toBeNull();
    expect(h.analytics.markSurveyShown()).toBe(false);
    expect(surveyEvents(h.fs)).toEqual(['playtest_survey_shown']);
  });

  it('keeps its counters across process kills: at most twice per install', () => {
    const h = recording();
    expect(complete(h, 2)).toEqual([1]);
    const next = recording(h.fs.reboot());
    expect(complete(next, 1)).toEqual([3]);
    const later = recording(next.fs.reboot());
    expect(complete(later, 5)).toEqual([]);
  });

  it('keeps its counters through a consent withdrawal (UI preference, design §13.3), not its events', () => {
    const h = recording();
    complete(h, 1);
    h.analytics.answerSurvey('yes', 1);
    expect(h.analytics.setConsent(false)).toBe(true);
    expect([...h.fs.files.keys()].sort()).toEqual([CONSENT_FILE, SURVEY_FILE].sort());
    // Nothing counts, shows or records while recording is off.
    h.analytics.noteSurveyMatchCompleted();
    expect(h.analytics.surveyDue()).toBeNull();
    expect(h.analytics.markSurveyShown()).toBe(false);
    h.analytics.answerSurvey('no', 2);
    expect(h.analytics.setConsent(true)).toBe(true);
    expect(surveyEvents(h.fs)).toEqual([]);
    // Back on: the count resumes at 1, so the second and last showing is the 3rd recorded match.
    expect(complete(h, 4)).toEqual([3]);
    expect(surveyEvents(h.fs)).toEqual(['playtest_survey_shown']);
  });

  it('never reads or writes its file with analytics.upload.enabled off', () => {
    const h = launch(boot(new MemoryFs(), false));
    h.analytics.noteSurveyMatchCompleted();
    expect(h.analytics.surveyDue()).toBeNull();
    expect(h.analytics.markSurveyShown()).toBe(false);
    h.analytics.answerSurvey('yes', 1);
    expect(h.fs.files.size).toBe(0);
  });

  it('reads an unreadable survey file as "already asked twice" (never nags)', () => {
    const h = recording();
    new DataStore(h.fs).replace(SURVEY_FILE, ['{"v":9}']);
    expect(complete(h, 3)).toEqual([]);
  });

  it('survives a full disk: the card shows once in this process, nothing throws', () => {
    const fs = new MemoryFs();
    fs.fullAfter = 0;
    const h = recording(fs);
    expect(complete(h, 1)).toEqual([1]);
    expect(h.analytics.surveyDue()).toBeNull();
    expect(h.fs.files.has(SURVEY_FILE)).toBe(false);
  });

  it('exports in exportFormat 1, so the KR readout can compute "would play again" per install', () => {
    const h = recording();
    h.analytics.markInteractive();
    complete(h, 1);
    h.analytics.answerSurvey('no', 1);
    complete(h, 2);
    h.analytics.answerSurvey('yes', 3);
    const result = h.analytics.prepareExport('42');
    if (!result.ok) throw new Error(result.reason);
    // The D1 decoder (zod) is the readout's import path.
    const decoded = decodePlaytestExport(result.file.text);
    if (!decoded.ok) throw new Error(decoded.error.code);
    // playtest-plan §5: the last non-dismissed answer per install.
    const answers = decoded.value.events.flatMap((e) =>
      e.event === 'playtest_survey_answered' && e.properties.answer !== 'dismissed'
        ? [{ install: e.user_id, answer: e.properties.answer }]
        : [],
    );
    expect(answers).toHaveLength(2);
    expect(answers.at(-1)).toEqual({ install: decoded.value.installId, answer: 'yes' });
    expect(decoded.value.events.filter((e) => e.event === 'playtest_survey_shown')).toHaveLength(2);
  });
});
