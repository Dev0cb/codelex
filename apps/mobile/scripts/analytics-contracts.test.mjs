// Sprint 4 D1: the analytics and playtest-export contracts load in plain Node (≥ 22.18, type stripping), without a
// bundler or a build step, so the data-analyst readout (task KR) and the TM-08 import reuse the app's own schemas.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const events = await import('../src/analytics/events.ts');
const playtest = await import('../src/export/playtest-data.ts');
const marker = await import('../src/analytics/session-marker.ts');

const INSTALL_ID = '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f';

const backgrounded = {
  event: 'app_backgrounded',
  schema_version: 1,
  event_id: '00000000-0000-4000-8000-000000000001',
  occurred_at: '2026-10-07T09:30:00.000Z',
  user_id: INSTALL_ID,
  session_id: '7d9e2f10-4a3b-4c5d-9e8f-0a1b2c3d4e5f',
  app_version: '0.1.0',
  platform: 'android',
  locale: 'fr-SN',
  properties: { foreground_ms: 480000 },
};

test('event schemas load and validate in Node', () => {
  assert.equal(events.EVENT_NAMES.length, 17);
  assert.deepEqual(events.parseAnalyticsEvent(backgrounded), { ok: true, event: backgrounded });
  assert.equal(events.parseAnalyticsEvent({ ...backgrounded, extra: 1 }).ok, false);
});

test('a playtest export round-trips through decodePlaytestExport in Node', () => {
  const header = {
    exportFormat: 1,
    kind: 'codelex.playtest_data',
    app: { version: '0.1.0', build: '7', platform: 'android' },
    installId: INSTALL_ID,
    exportedAt: '2026-10-07T18:00:00.000Z',
    dropped: { queueCap: 0, expired: 0, invalid: 0 },
  };
  const built = playtest.buildPlaytestExport(header, [backgrounded]);
  assert.equal(built.ok, true);
  const decoded = playtest.decodePlaytestExport(built.value.text);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value.events, [backgrounded]);
});

test('the session-marker model loads in Node', () => {
  assert.equal(marker.decideAtLaunch(true).previousExitUnclean, true);
});
