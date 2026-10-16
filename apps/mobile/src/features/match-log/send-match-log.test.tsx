/**
 * "Send match log" in Settings (E-1.5 AC-20 export, design §5.8; slice S6d; threat model TM-04, TM-05, TM-07):
 * behind `playtest.match_log.enabled`, independent of analytics consent; the confirm sheet with the scope and the
 * email notice in EN and FR; the allowlisted file through the one share path, deleted when the sheet closes; the
 * empty and failure states; no file read before Share.
 */
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Locale } from '@codelex/i18n';
import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { createTestAnalytics } from '../../analytics/test-analytics';
import { FlagsProvider } from '../../config/flags-provider';
import type * as ExportAddress from '../../config/export-address';
import { resolveExportAddress } from '../../config/export-address';
import { decodeMatchLog } from '../../export/match-log';
import { I18nProvider } from '../../i18n/i18n-provider';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createMatchLogAccess, MatchLogContext } from '../../match-log/match-log-access';
import { buildMatchLogFile, type MatchLogApp } from '../../match-log/match-log-file';
import { playMatchConfig } from '../../match/play-config';
import { loadBundledLexicon, scriptMatch, seedOf } from '../../match/test-support';
import { DataStore } from '../../persistence/data-store';
import { FILES } from '../../persistence/match-journal';
import { MemoryFs } from '../../persistence/memory-fs';
import { createPersistence, finishMatch, persistTransition } from '../../persistence/saved-match';
import { MotionPreferenceProvider } from '../../settings/motion-preference';
import type * as ShareFile from '../../sharing/share-file';
import { shareTextFile } from '../../sharing/share-file';
import { ShareContext } from '../../sharing/share-provider';
import { createTestShare, type TestShare } from '../../sharing/test-share';
import { SettingsScreen } from '../settings/settings-screen';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));
jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));
// The one share path (spied, real by default): a double tap must start one share.
jest.mock('../../sharing/share-file', () => {
  const actual = jest.requireActual<typeof ShareFile>('../../sharing/share-file');
  return { ...actual, shareTextFile: jest.fn(actual.shareTextFile) };
});
// TM-07: the sheet's address comes from the bundled-allowlist resolver only (spied, real by default).
jest.mock('../../config/export-address', () => {
  const actual = jest.requireActual<typeof ExportAddress>('../../config/export-address');
  return { ...actual, resolveExportAddress: jest.fn(actual.resolveExportAddress) };
});

const VERSIONS = { app: '0.1.0', rules: 1, lexicon: '2f2cc6fca8fac92b' };
const APP: MatchLogApp = { version: '0.1.0', build: '42', platform: 'ios' };
const EMAIL_EN =
  'If you send the match log by email, the team sees your email address (and anything your mail app adds, such as your name). Match logs are kept in restricted Google storage, which may be outside your country, and the emails are deleted within 7 days. A copy stays in your own Sent folder.';
const EMAIL_FR =
  "Si tu envoies le journal de partie par e-mail, l'équipe voit ton adresse (et ce que ton app de messagerie ajoute, comme ton nom). Les journaux de partie sont conservés dans un stockage Google restreint, parfois hors de ton pays, et les e-mails sont supprimés sous 7 jours. Une copie reste dans tes messages envoyés.";

let lexicon: LoadedLexicon;
let ctx: { readonly lexicon: LoadedLexicon['index'] };

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
});
afterEach(() => {
  const actual = jest.requireActual<typeof ExportAddress>('../../config/export-address');
  jest.mocked(resolveExportAddress).mockReset().mockImplementation(actual.resolveExportAddress);
});

/** A disk holding a match of `n` actions, persisted as the app does; finished (rotated) when `finish`. */
function diskWithMatch(seedNumber: number, n: number, finish = false): MemoryFs {
  const fs = new MemoryFs();
  const persistence = createPersistence(fs);
  const seed = seedOf(seedNumber);
  const { start, steps } = scriptMatch(seed, lexicon, n);
  persistence.journal.start(playMatchConfig(seed, lexicon.index));
  let before = start;
  for (const step of steps) {
    persistTransition(persistence.journal, before, step.after, ctx);
    before = step.after;
  }
  if (finish) finishMatch(persistence, before);
  fs.reads.length = 0;
  return fs;
}

interface Options {
  readonly flag?: boolean;
  readonly analytics?: boolean;
  readonly locale?: Locale;
}

async function renderSettings(
  fs: MemoryFs,
  { flag = true, analytics = false, locale = 'en' }: Options = {},
): Promise<TestShare> {
  const recorder = createTestAnalytics(new MemoryFs(), analytics);
  const share = createTestShare();
  const access = createMatchLogAccess(new DataStore(fs), ctx, APP);
  await render(
    <I18nProvider locale={locale}>
      <FlagsProvider
        flags={{ 'analytics.upload.enabled': analytics, 'playtest.match_log.enabled': flag }}
      >
        <CreateAnalyticsContext value={() => recorder}>
          <AnalyticsProvider>
            <MotionPreferenceProvider fs={new MemoryFs()}>
              <MatchLogContext value={access}>
                <ShareContext value={share}>
                  <SettingsScreen versions={VERSIONS} />
                </ShareContext>
              </MatchLogContext>
            </MotionPreferenceProvider>
          </AnalyticsProvider>
        </CreateAnalyticsContext>
      </FlagsProvider>
    </I18nProvider>,
  );
  return share;
}

async function tap(testID: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(testID));
    await Promise.resolve();
  });
}

describe('Send match log in Settings (S6d)', () => {
  it('is not rendered while playtest.match_log.enabled is off (default)', async () => {
    await renderSettings(diskWithMatch(5101, 2), { flag: false });
    expect(screen.queryByTestId('settings.sendMatchLog')).toBeNull();
    expect(screen.queryByTestId('settings.playtest')).toBeNull();
  });

  it('shows the row with its description under Playtest data, with analytics off', async () => {
    await renderSettings(diskWithMatch(5102, 2));
    const row = screen.getByTestId('settings.sendMatchLog');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe(
      'Send match log, For bug reports. Contains moves, no personal data.',
    );
    expect(screen.getByText('Playtest data')).toBeTruthy();
    // The analytics rows stay behind their own flag.
    expect(screen.queryByTestId('settings.analytics.toggle')).toBeNull();
    expect(screen.queryByTestId('settings.sendData')).toBeNull();
  });

  it('works with analytics consent off (a user-initiated bug report, TM-05)', async () => {
    await renderSettings(diskWithMatch(5103, 2), { analytics: true });
    expect(screen.getByTestId('settings.sendData')).toBeTruthy();
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('settings.analytics.off.confirm'));
    expect(screen.getByTestId('settings.analytics.toggle').props.value).toBe(false);
    expect(screen.queryByTestId('settings.sendData')).toBeNull();
    expect(screen.getByTestId('settings.sendMatchLog')).toBeTruthy();
  });

  it('reads no match file on mount nor on opening the sheet, only on Share (TM-02 E-1)', async () => {
    const fs = diskWithMatch(5104, 3);
    const share = await renderSettings(fs);
    expect(fs.reads).toEqual([]);
    await tap('settings.sendMatchLog');
    expect(screen.getByTestId('matchlog.sheet')).toBeTruthy();
    expect(fs.reads).toEqual([]);
    expect(share.writes).toBe(0);
  });

  it('confirms the in-progress match with the email notice (TM-05, EN)', async () => {
    await renderSettings(diskWithMatch(5105, 3));
    await tap('settings.sendMatchLog');
    expect(screen.getByText('Send match log?')).toBeTruthy();
    expect(screen.getByTestId('matchlog.confirm.body').props.children).toBe(
      'The file holds the moves, seed and versions of your current match. No personal data in the file.',
    );
    expect(screen.getByTestId('matchlog.emailNotice').props.children).toBe(EMAIL_EN);
    expect(screen.getByTestId('matchlog.share')).toBeTruthy();
    // TM-07: the address comes from the bundled allowlist only, with no remote value; none is configured (O-4).
    expect(resolveExportAddress).toHaveBeenCalledWith(undefined);
    expect(screen.queryByTestId('matchlog.recipient')).toBeNull();
  });

  it('confirms the last finished match in French, with the French email notice (TM-05, FR)', async () => {
    await renderSettings(diskWithMatch(5106, 4, true), { locale: 'fr' });
    expect(screen.getByText('Envoyer le journal de partie')).toBeTruthy();
    await tap('settings.sendMatchLog');
    expect(screen.getByText('Envoyer le journal de partie ?')).toBeTruthy();
    expect(screen.getByTestId('matchlog.confirm.body').props.children).toBe(
      'Le fichier contient les coups, la graine et les versions de ta dernière partie terminée. Aucune donnée personnelle dans le fichier.',
    );
    expect(screen.getByTestId('matchlog.emailNotice').props.children).toBe(EMAIL_FR);
    expect(screen.getByText('Partager le journal…')).toBeTruthy();
  });

  it('shows only the allowlisted address when one is configured (TM-07)', async () => {
    jest.mocked(resolveExportAddress).mockReturnValue('playtest@codelex.example');
    await renderSettings(diskWithMatch(5107, 1));
    await tap('settings.sendMatchLog');
    expect(screen.getByTestId('matchlog.recipient').props.children).toBe(
      'Send it to: playtest@codelex.example',
    );
  });

  it('says there is nothing to export when no match is saved', async () => {
    const share = await renderSettings(new MemoryFs());
    await tap('settings.sendMatchLog');
    expect(screen.getByTestId('matchlog.empty').props.children).toBe('No match to export yet.');
    expect(screen.queryByTestId('matchlog.share')).toBeNull();
    await tap('matchlog.close');
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
    expect(share.writes).toBe(0);
  });

  it('shares the allowlisted file through the one share path and deletes it when the sheet closes (TM-04)', async () => {
    const fs = diskWithMatch(5108, 5);
    const share = await renderSettings(fs);
    share.holdSheet = true;
    await tap('settings.sendMatchLog');
    await tap('matchlog.share');
    expect(share.opened).toHaveLength(1);
    const opened = share.opened[0];
    expect(opened?.options).toEqual({
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Send match log',
    });
    expect(opened?.uri).toMatch(
      /^file:\/\/\/cache\/codelex-share\/[0-9a-f-]{36}\/codelex-match-log\.json$/,
    );
    const text = opened?.files.get('codelex-match-log.json') ?? '';
    const expected = buildMatchLogFile(new DataStore(fs), 'current', APP, ctx);
    expect(expected.ok && expected.value).toBe(text);
    expect(decodeMatchLog(text).ok).toBe(true);
    // Only the match file was read: nothing else of codelex-data.
    expect([...new Set(fs.reads)]).toEqual([FILES.log]);
    // While the sheet is open the buttons are disabled; then the file is gone and the sheet closes.
    expect(screen.getByTestId('matchlog.share').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
  });

  it('shows a share error with Try again, and a file error when the file cannot be written', async () => {
    const share = await renderSettings(diskWithMatch(5109, 2));
    await tap('settings.sendMatchLog');
    share.available = false;
    await tap('matchlog.share');
    expect(screen.getByTestId('matchlog.error').props.children).toBe(
      "The share sheet isn't available right now. Try again.",
    );
    expect(screen.getByText('Try again')).toBeTruthy();
    share.available = true;
    share.failWrite = true;
    await tap('matchlog.share');
    expect(screen.getByTestId('matchlog.error').props.children).toBe(
      "Couldn't prepare the file. Check your free storage and try again.",
    );
    expect(share.files.size).toBe(0);
    await tap('matchlog.share');
    expect(share.opened).toHaveLength(1);
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
  });

  it('starts one share for a double tap on Share (in-flight latch), and marks the button busy', async () => {
    const share = await renderSettings(diskWithMatch(5111, 3));
    share.holdSheet = true;
    await tap('settings.sendMatchLog');
    jest.mocked(shareTextFile).mockClear();
    expect(screen.getByTestId('matchlog.share').props.accessibilityState).toMatchObject({
      busy: false,
    });
    await act(async () => {
      // Both taps land before React re-renders the disabled button.
      const button = screen.getByTestId('matchlog.share');
      await fireEvent.press(button);
      await fireEvent.press(button);
      await Promise.resolve();
    });
    expect(shareTextFile).toHaveBeenCalledTimes(1);
    expect(share.opened).toHaveLength(1);
    expect(screen.getByTestId('matchlog.share').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
  });

  it('can be closed while the share sheet is open; the late result is ignored and the file still deleted', async () => {
    const share = await renderSettings(diskWithMatch(5112, 3));
    share.holdSheet = true;
    await tap('settings.sendMatchLog');
    await tap('matchlog.share');
    expect(share.opened).toHaveLength(1);
    expect(screen.getByTestId('matchlog.cancel').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    await tap('matchlog.cancel');
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
    // Reopened before the OS sheet reports back: the old result must not close or change it.
    await tap('settings.sendMatchLog');
    expect(screen.getByTestId('matchlog.sheet')).toBeTruthy();
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
    expect(screen.getByTestId('matchlog.sheet')).toBeTruthy();
    expect(screen.queryByTestId('matchlog.error')).toBeNull();
    expect(screen.getByTestId('matchlog.share').props.accessibilityState).toMatchObject({
      disabled: false,
      busy: false,
    });
    // And a new share works.
    share.holdSheet = false;
    await tap('matchlog.share');
    expect(share.opened).toHaveLength(2);
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
  });

  it('closes with system back while the share sheet is open', async () => {
    const share = await renderSettings(diskWithMatch(5113, 2));
    share.holdSheet = true;
    await tap('settings.sendMatchLog');
    await tap('matchlog.share');
    await act(async () => {
      // Android back: the Modal's onRequestClose.
      await fireEvent(screen.getByTestId('matchlog.sheet'), 'requestClose');
    });
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
  });

  it('cancels without writing anything', async () => {
    const share = await renderSettings(diskWithMatch(5110, 2));
    await tap('settings.sendMatchLog');
    await tap('matchlog.cancel');
    expect(screen.queryByTestId('matchlog.sheet')).toBeNull();
    expect(share.writes).toBe(0);
  });
});
