/**
 * Send playtest data (E-1.5 design §5.9, AC-17; slice S6c): summary on open, the file built on tap in
 * `exportFormat: 1`, OS share sheet with temp-file cleanup (TM-04), "Did you send the file?", clearing exactly the
 * shared events, multi-round sharing of a full queue, failure states, consent off, EN/FR, screen-reader roles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Locale } from '@codelex/i18n';
import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { EventQueue, QUEUE_FILE } from '../../analytics/event-queue';
import { decodePlaytestExport } from '../../export/playtest-data';
import { createTestAnalytics, TEST_NOW } from '../../analytics/test-analytics';
import type { PlaytestAnalytics } from '../../analytics/recorder';
import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { DataStore } from '../../persistence/data-store';
import { asciiJson } from '../../persistence/match-journal';
import { MemoryFs } from '../../persistence/memory-fs';
import { ShareContext } from '../../sharing/share-provider';
import { createTestShare, type TestShare } from '../../sharing/test-share';
import { formatDay, SendDataScreen } from './send-data-screen';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), dismissTo: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));

interface Rendered {
  readonly fs: MemoryFs;
  readonly analytics: PlaytestAnalytics;
  readonly share: TestShare;
}

/** A recording install with `n` events queued (plus the cold `app_opened` when `interactive`). */
async function renderScreen(
  n: number,
  locale: Locale = 'en',
  fs = new MemoryFs(),
): Promise<Rendered> {
  const analytics = createTestAnalytics(fs, true);
  analytics.start();
  analytics.onAppState('active');
  analytics.load();
  for (let i = 0; i < n; i += 1) analytics.record('app_backgrounded', { foreground_ms: i });
  const share = createTestShare();
  await render(
    <I18nProvider locale={locale}>
      <FlagsProvider flags={{ 'analytics.upload.enabled': true }}>
        <CreateAnalyticsContext value={() => analytics}>
          <AnalyticsProvider>
            <ShareContext value={share}>
              <SendDataScreen />
            </ShareContext>
          </AnalyticsProvider>
        </CreateAnalyticsContext>
      </FlagsProvider>
    </I18nProvider>,
  );
  return { fs, analytics, share };
}

/**
 * The disk of a recording install whose queue holds `n` `app_backgrounded` events, written in one go: one event is
 * recorded (so it went through the recorder's checks and carries this install's ids), then cloned `n` times with fresh
 * event ids and sequence numbers into a single queue-file write. Recording them one by one costs ≈ 2 s for a full
 * queue. Returns the disk as the next process finds it: its load enforces the cap and counts what it drops, like a
 * kill between an append and the cap's meta write.
 */
function seedQueue(n: number): MemoryFs {
  const fs = new MemoryFs();
  const analytics = createTestAnalytics(fs, true);
  analytics.start();
  analytics.onAppState('active');
  analytics.load();
  analytics.record('app_backgrounded', { foreground_ms: 0 });
  const [template] = new EventQueue(new DataStore(fs.reboot()), () => TEST_NOW).events();
  if (template === undefined) throw new Error('seed event not recorded');
  const records = Array.from({ length: n }, (_, i) =>
    asciiJson({
      s: i,
      e: {
        ...template,
        event_id: `22222222-2222-4222-8222-${i.toString(16).padStart(12, '0')}`,
        properties: { foreground_ms: i },
      },
    }),
  );
  new DataStore(fs).replace(QUEUE_FILE, records);
  return fs.reboot();
}

const queuedNames = (fs: MemoryFs): string[] =>
  new EventQueue(new DataStore(fs.reboot()), () => Date.parse('2026-10-07T09:30:00.000Z'))
    .events()
    .map((e) => e.event);

async function tapShare(): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByTestId('export.share'));
    await Promise.resolve();
  });
}

describe('SendDataScreen (§5.9)', () => {
  it('summarises the file on open, from counts only, and builds nothing yet', async () => {
    const { share, analytics } = await renderScreen(3);
    expect(screen.getAllByRole('header').map((h) => h.props.children as string)).toEqual([
      'Send playtest data',
      'What is in the file',
      'Never included',
    ]);
    expect(
      screen.getByText(
        "This sends one file to the CODELEX playtest team through your phone's share menu. Send it by email to the address below.",
      ),
    ).toBeTruthy();
    const day = formatDay(Date.parse('2026-10-07T09:30:00.000Z'), 'en');
    expect(screen.getByTestId('export.summary.counts').props.children).toBe(
      `3 events · 0 matches · ${day} to ${day}`,
    );
    // Every family of the catalogue is listed (privacy review M2), in this order.
    expect(
      screen
        .getAllByText(/./)
        .map((node) => node.props.children as unknown)
        .filter((text): text is string => typeof text === 'string')
        .filter((text) =>
          [
            'App starts (connection type, whether the last session crashed) and session length',
            'Match start, end and result: scores, length, opponent',
            'Words you and the bot played: term, category, points — not what you typed',
            'Rejected attempts: reason and word length only, never the word',
            'Knowledge Cards you opened and for how long',
            'Your answers to the “play again” question',
            'Screens and buttons used: first-launch steps, after-match choices, knowledge graph browsing, bot thinking time',
            'Technical details: app version and build, Android, app language, phone-clock times, session IDs, dropped-event counts',
          ].includes(text),
        ),
    ).toHaveLength(8);
    expect(
      screen.getByText(
        "Your name, email address, contacts, location, advertising ID, phone model or serial number. Your tester ID is a random number made by this app, not your phone's ID.",
      ),
    ).toBeTruthy();
    const id = screen.getByTestId('export.installId');
    expect(id.props.children).toBe(`Your tester ID: ${analytics.getSnapshot().installId ?? ''}`);
    expect(id.props.selectable).toBe(true);
    expect(
      screen.getByText(
        'If you send it by email, the team sees your email address (and anything your mail app adds, such as your name) and can link it to your tester ID. Files are kept in restricted Google storage, which may be outside your country, and the emails are deleted within 7 days. A copy stays in your own Sent folder.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Works offline/)).toBeTruthy();
    // TM-07: no address is configured (O-4), so the line is hidden. No drop warning without drops.
    expect(screen.queryByTestId('export.recipient')).toBeNull();
    expect(screen.queryByTestId('export.dropped')).toBeNull();
    expect(share.opened).toHaveLength(0);
  });

  it('shares the exportFormat 1 file through the sheet, deletes it, and asks "Did you send the file?"', async () => {
    const { share, fs } = await renderScreen(3);
    share.holdSheet = true;
    await tapShare();
    expect(share.opened).toHaveLength(1);
    const opened = share.opened[0];
    expect(opened?.options).toEqual({
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Send playtest data',
    });
    const text = opened?.files.get('codelex-playtest-data.json') ?? '';
    const decoded = decodePlaytestExport(text);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(decoded.value.events).toHaveLength(3);
    expect(decoded.value.remaining).toBe(0);
    // While the sheet is open, Share cannot be tapped twice.
    expect(screen.getByTestId('export.share').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
    expect(screen.getByText('Did you send the file?')).toBeTruthy();
    expect(screen.queryByTestId('export.confirm.more')).toBeNull();
    await fireEvent.press(screen.getByTestId('export.confirm.confirm'));
    expect(screen.getByTestId('export.done').props.children).toBe('Thanks! 3 events cleared.');
    expect(queuedNames(fs)).toEqual(['analytics_buffer_flushed']);
    // The summary is read again: only the flushed event waits now. The whole queue fitted in this one file, so
    // there is no "next file" to share: events recorded since (the flush itself, Android backgrounding for the
    // share sheet) travel with a later export.
    expect(screen.getByTestId('export.summary.counts').props.children).toMatch(/^1 event · /);
    expect(screen.queryByTestId('export.remaining')).toBeNull();
    expect(screen.queryByText(/Share the next file/)).toBeNull();
  });

  it('a single-file export never asks for a next file, even with events recorded while the sheet was open', async () => {
    const { share, analytics } = await renderScreen(2);
    share.holdSheet = true;
    await tapShare();
    // The share sheet backgrounds the app on Android: lifecycle events land in the queue meanwhile.
    analytics.onAppState('background');
    analytics.onAppState('active');
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('export.confirm.confirm'));
    expect(screen.getByTestId('export.done').props.children).toBe('Thanks! 2 events cleared.');
    expect(analytics.queuedCount()).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('export.remaining')).toBeNull();
  });

  it('"Not yet" keeps every event and the Share button', async () => {
    const { fs } = await renderScreen(2);
    await tapShare();
    await fireEvent.press(screen.getByTestId('export.confirm.cancel'));
    expect(queuedNames(fs)).toEqual(['app_backgrounded', 'app_backgrounded']);
    expect(screen.queryByTestId('export.done')).toBeNull();
    expect(screen.getByTestId('export.share').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('shares a full queue in several files and warns about drops at the cap', async () => {
    const { share } = await renderScreen(0, 'en', seedQueue(5001));
    expect(screen.getByTestId('export.dropped').props.children).toMatch(
      /^1 older event was dropped because the buffer is full \(limit 5,?000\)\.$/,
    );
    await tapShare();
    const first = decodePlaytestExport(
      share.opened[0]?.files.get('codelex-playtest-data.json') ?? '',
    );
    if (!first.ok) throw new Error('decode');
    expect(first.value.remaining).toBeGreaterThan(0);
    expect(first.value.dropped.queueCap).toBe(1);
    expect(screen.getByTestId('export.confirm.more').props.children).toBe(
      `${first.value.remaining.toLocaleString('en')} more events will go in the next file.`,
    );
    await fireEvent.press(screen.getByTestId('export.confirm.confirm'));
    // The count is the file's own `remaining` (left out by the 1 MB cap), not the live queue (which also holds the
    // `analytics_buffer_flushed` just recorded).
    expect(screen.getByTestId('export.remaining').props.children).toBe(
      `${first.value.remaining.toLocaleString('en')} events are still waiting. Share the next file.`,
    );
    // The drop was reported in the first file: the warning is gone.
    expect(screen.queryByTestId('export.dropped')).toBeNull();
    await tapShare();
    const second = decodePlaytestExport(
      share.opened[1]?.files.get('codelex-playtest-data.json') ?? '',
    );
    if (!second.ok) throw new Error('decode');
    expect(second.value.dropped).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
    const ids = new Set(first.value.events.map((e) => e.event_id));
    expect(second.value.events.some((e) => ids.has(e.event_id))).toBe(false);
  });

  it('says when the share sheet is unavailable or the file cannot be written, and offers Try again', async () => {
    const { share } = await renderScreen(1);
    share.available = false;
    await tapShare();
    expect(screen.getByTestId('export.error').props.children).toBe(
      "The share sheet isn't available right now. Try again.",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    share.available = true;
    share.failWrite = true;
    await tapShare();
    expect(screen.getByTestId('export.error').props.children).toBe(
      "Couldn't prepare the file. Check your free storage and try again.",
    );
    expect(share.files.size).toBe(0);
    await tapShare();
    expect(screen.queryByTestId('export.error')).toBeNull();
    expect(screen.getByText('Did you send the file?')).toBeTruthy();
  });

  it('says when the sent events could not be cleared, and clears them on Try again', async () => {
    const { fs } = await renderScreen(2);
    await tapShare();
    fs.fullAfter = 0;
    await fireEvent.press(screen.getByTestId('export.confirm.confirm'));
    expect(screen.getByTestId('export.clearError').props.children).toBe(
      "Couldn't clear the sent events from your phone. They stay until you try again.",
    );
    expect(screen.queryByTestId('export.done')).toBeNull();
    await fireEvent.press(screen.getByTestId('export.clearRetry'));
    expect(screen.getByTestId('export.clearError')).toBeTruthy();
    fs.fullAfter = null;
    await fireEvent.press(screen.getByTestId('export.clearRetry'));
    expect(screen.queryByTestId('export.clearError')).toBeNull();
    expect(screen.getByTestId('export.done').props.children).toBe('Thanks! 2 events cleared.');
    expect(queuedNames(fs)).toEqual(['analytics_buffer_flushed']);
  });

  it('shows the oldest event on request, collapsed by default', async () => {
    await renderScreen(2);
    const toggle = screen.getByTestId('export.sample.toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId('export.sample')).toBeNull();
    await fireEvent.press(toggle);
    expect(screen.getByTestId('export.sample.toggle').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    const sample = JSON.parse(screen.getByTestId('export.sample').props.children as string) as {
      event: string;
    };
    expect(sample.event).toBe('app_backgrounded');
    await fireEvent.press(screen.getByTestId('export.sample.toggle'));
    expect(screen.queryByTestId('export.sample')).toBeNull();
  });

  it('disables Share on an empty queue and explains why', async () => {
    await renderScreen(0);
    expect(screen.getByTestId('export.empty').props.children).toBe(
      'Nothing to send yet. Play a match first.',
    );
    const shareButton = screen.getByTestId('export.share');
    expect(shareButton.props.accessibilityState).toMatchObject({ disabled: true });
    expect(shareButton.props.accessibilityHint).toBe('Nothing to send yet. Play a match first.');
  });

  it('with recording off, offers to turn it on in Settings and shows no Share', async () => {
    const { router } = jest.requireMock<{ router: { dismissTo: jest.Mock } }>('expo-router');
    const fs = new MemoryFs();
    const off = createTestAnalytics(fs, true);
    off.start();
    off.setConsent(false);
    await renderScreen(0, 'en', fs.reboot());
    expect(screen.getByText('Recording is off, so there is nothing to send.')).toBeTruthy();
    expect(screen.queryByTestId('export.share')).toBeNull();
    await fireEvent.press(screen.getByTestId('export.off.action'));
    expect(router.dismissTo).toHaveBeenCalledWith('/settings');
  });

  it('goes back with the back button', async () => {
    const { router } = jest.requireMock<{ router: { back: jest.Mock } }>('expo-router');
    await renderScreen(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('renders French copy', async () => {
    await renderScreen(2, 'fr');
    expect(screen.getAllByRole('header')[0]?.props.children).toBe('Envoyer les données de test');
    const day = formatDay(Date.parse('2026-10-07T09:30:00.000Z'), 'fr');
    expect(screen.getByTestId('export.summary.counts').props.children).toBe(
      `2 événements · 0 partie · du ${day} au ${day}`,
    );
    expect(screen.getByText('Partager le fichier…')).toBeTruthy();
    expect(
      screen.getByText(
        'Écrans et boutons utilisés\u00a0: premières étapes, choix après la partie, navigation dans le graphe, temps de réflexion du bot',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/stockage Google restreint, parfois hors de ton pays/)).toBeTruthy();
    expect(screen.getByText(/pas l’identifiant de ton téléphone\.$/)).toBeTruthy();
  });

  it('formatDay falls back to an ISO date without Intl', () => {
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(() => {
      throw new RangeError('no Intl');
    });
    expect(formatDay(Date.parse('2026-10-07T09:30:00.000Z'), 'fr')).toBe('2026-10-07');
    spy.mockRestore();
  });
});
