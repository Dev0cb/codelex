/**
 * The playtest recorder (E-1.5 AC-17, slice S6a): dark-launch flag, consent, purge, install id, the session-marker
 * contract of `session-marker.ts` (`previous_exit_unclean`) and `app_backgrounded.foreground_ms`, validation of every
 * event before it is queued. Processes are simulated on an in-memory disk: `fs.reboot()` is the next cold start.
 */
import { describe, expect, it } from '@jest/globals';

import { DataStore } from '../persistence/data-store';
import { MemoryFs } from '../persistence/memory-fs';
import { CONSENT_FILE } from './consent';
import { EventQueue, QUEUE_FILE, QUEUE_MAX_AGE_MS, QUEUE_META_FILE } from './event-queue';
import type { AnalyticsEvent, EventProperties } from './events';
import { INSTALL_ID_FILE, isUuidV4 } from './install-id';
import { ANALYTICS_FILE_NAMES, PlaytestAnalytics, type AnalyticsPlatform } from './recorder';
import { SESSION_MARKER_FILE } from './session-marker';
import { eventId } from './test-support';

const T0 = Date.parse('2026-10-07T09:30:00.000Z');

interface Harness {
  readonly fs: MemoryFs;
  readonly analytics: PlaytestAnalytics;
  readonly clock: { wall: number; mono: number; sinceStart: number };
}

let uuidCounter = 0;
const newUuid = (): string => {
  uuidCounter += 1;
  return eventId(uuidCounter);
};

function boot(fs: MemoryFs, enabled = true, wall = T0): Harness {
  const clock = { wall, mono: 0, sinceStart: 1840 };
  const platform: AnalyticsPlatform = {
    fs,
    randomUUID: newUuid,
    wallMs: () => clock.wall,
    monoMs: () => clock.mono,
    sinceProcessStartMs: () => clock.sinceStart,
    context: () => ({ app_version: '0.1.0', platform: 'android', locale: 'fr-SN' }),
  };
  return { fs, analytics: new PlaytestAnalytics(platform, enabled), clock };
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
    expect(fs.boundaries).toBe(0);
    expect(fs.reads).toEqual([]);
    expect(h.analytics.getSnapshot()).toEqual({
      enabled: false,
      consent: false,
      noticeVisible: false,
      installId: null,
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
    let notified = 0;
    const unsubscribe = h.analytics.subscribe(() => {
      notified += 1;
    });
    expect(h.analytics.setConsent(false)).toBe(true);
    unsubscribe();
    expect(notified).toBe(1);
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
    const owned = [CONSENT_FILE, INSTALL_ID_FILE, QUEUE_FILE, QUEUE_META_FILE, SESSION_MARKER_FILE];
    expect([...fs.files.keys()].sort()).toEqual([...owned].sort());
    expect([...ANALYTICS_FILE_NAMES].sort()).toEqual([...owned].sort());
  });
});
