/**
 * DG1-c/DG1-e: the Diagnostics screen in EN and FR (local catalog checked with `checkCatalogs`), run with progress
 * and Cancel, interruption when the app leaves the foreground, the owner's RAM/class choice, and "Share report…"
 * through the TM-04 path (S6c `shareTextFile`: the file exists only while the sheet is open). A run adds nothing to
 * the analytics queue (DS-7).
 */
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { parseDiagnosticsReportText } from '@codelex/golden-runner';
import { checkCatalogs, type Locale } from '@codelex/i18n';
import { GOLDEN_CORPUS } from '@codelex/golden-runner/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { createTestAnalytics } from '../analytics/test-analytics';
import { I18nProvider } from '../i18n/i18n-provider';
import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { loadBundledLexicon } from '../match/test-support';
import { MemoryFs } from '../persistence/memory-fs';
import { createTestShare, type TestShare } from '../sharing/test-share';
import { runtimeCheck } from './device-info';
import { DiagnosticsScreen } from './diagnostics-screen';
import { DIAGNOSTICS_CATALOGS } from './messages/catalog';
import { createScratchStore } from './scratch-fs';
import type { DiagnosticsDeps } from './use-diagnostics';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

const SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const DEVICE = {
  platform: 'android',
  model: 'Google Pixel 7a',
  osVersion: 'Android 15 (API 35)',
} as const;

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** A UI yield the test releases by hand, so a run can be observed (and cancelled) between two cases. */
function heldYield(): { yieldToUi: () => Promise<void>; release: () => void } {
  const waiting: (() => void)[] = [];
  return {
    yieldToUi: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
    release: () => {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

function deps(release = true): DiagnosticsDeps {
  let t = 0;
  return {
    lexicon: lexicon.index,
    clock: () => (t += 0.5),
    store: createScratchStore(),
    runtime: runtimeCheck(
      release
        ? { getRuntimeProperties: () => ({ 'OSS Release Version': '250829098.0.17' }) }
        : undefined,
      false,
    ),
    yieldToUi: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      }),
    settle: () => Promise.resolve(),
    sizes: {
      positions: 2,
      hasBatches: 2,
      applyPasses: 1,
      resumeMatches: 1,
      resumeIterations: 1,
      driftMatches: 10,
    },
  };
}

async function renderScreen(
  options: {
    locale?: Locale;
    share?: TestShare;
    gitSha?: string | null;
    release?: boolean;
    yieldToUi?: () => Promise<void>;
  } = {},
): Promise<{ share: TestShare; onClose: jest.Mock }> {
  const share = options.share ?? createTestShare();
  const onClose = jest.fn();
  await render(
    <I18nProvider locale={options.locale ?? 'en'}>
      <DiagnosticsScreen
        deps={{
          ...deps(options.release ?? true),
          ...(options.yieldToUi === undefined ? {} : { yieldToUi: options.yieldToUi }),
        }}
        corpus={GOLDEN_CORPUS}
        device={DEVICE}
        appVersion="0.1.0"
        gitSha={options.gitSha === undefined ? SHA : options.gitSha}
        share={share}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { share, onClose };
}

async function runGoldens(): Promise<void> {
  await fireEvent.press(screen.getByTestId('diagnostics.run.goldens'));
  await waitFor(
    () => {
      expect(screen.getByTestId('diagnostics.status.goldens').props.children).toBe('✓ Pass');
    },
    { timeout: 120_000 },
  );
}

describe('local EN/FR catalog (DS-8)', () => {
  it('passes checkCatalogs (keys, ICU, FR typography)', () => {
    expect(checkCatalogs(DIAGNOSTICS_CATALOGS)).toEqual([]);
  });
});

describe('DiagnosticsScreen', () => {
  it('lists suites 1–5 in EN with the build check, nothing run yet, share unavailable', async () => {
    await renderScreen();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByTestId('diagnostics.build').props.children).toBe(
      'Release build · Hermes 250829098.0.17',
    );
    expect(screen.getByTestId('CODELEX_GOLDEN_RUNNER_V1')).toBeTruthy();
    for (const suite of ['goldens', 'micro', 'bots', 'resume', 'drift']) {
      expect(screen.getByTestId(`diagnostics.status.${suite}`).props.children).toBe('– Not run');
    }
    expect(screen.getByTestId('diagnostics.share')).toBeDisabled();
    expect(screen.getByTestId('diagnostics.share.needs')).toBeTruthy();
    expect(screen.getByLabelText('Run, Bot compute')).toBeTruthy();
  });

  it('renders in FR and warns on a non-release build or a build without a commit', async () => {
    await renderScreen({ locale: 'fr', release: false, gitSha: null });
    expect(screen.getByText('Diagnostic')).toBeTruthy();
    expect(screen.getByText('Tout lancer')).toBeTruthy();
    expect(screen.getByTestId('diagnostics.build').props.children).toBe(
      'Ce n’est pas une version release Hermes. Ses mesures ne sont pas valables.',
    );
    expect(screen.getByTestId('diagnostics.noCommit')).toBeTruthy();
  });

  it('runs the goldens, then shares a valid report through the TM-04 path once RAM and class are picked', async () => {
    const analytics = createTestAnalytics(new MemoryFs(), true);
    analytics.setConsent(true);
    const queued = analytics.queuedCount();
    const { share } = await renderScreen();
    share.holdSheet = true;
    await runGoldens();
    expect(screen.getByTestId('diagnostics.share')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('diagnostics.ram.4gb'));
    await fireEvent.press(screen.getByTestId('diagnostics.class.owner-device'));
    expect(screen.queryByTestId('diagnostics.share.needs')).toBeNull();
    await fireEvent.press(screen.getByTestId('diagnostics.share'));
    // The file exists only while the sheet is open, in the share directory, under its fixed name.
    await waitFor(() => {
      expect(share.opened).toHaveLength(1);
    });
    const [opened] = share.opened;
    expect(opened?.uri).toMatch(
      /^file:\/\/\/cache\/codelex-share\/[0-9a-f-]{36}\/codelex-diagnostics\.json$/,
    );
    expect(opened?.options).toEqual({
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Share report…',
    });
    const text = opened?.files.get('codelex-diagnostics.json') ?? '';
    const parsed = parseDiagnosticsReportText(text);
    expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
    if (parsed.ok) {
      expect(parsed.value.device).toEqual({
        ...DEVICE,
        ramClass: '4gb',
        deviceClass: 'owner-device',
      });
      expect(parsed.value.build).toEqual({ appVersion: '0.1.0', gitSha: SHA, profile: 'preview' });
      expect(parsed.value.benches.drift).toEqual({ status: 'not-measured', reason: 'not-run' });
    }
    await act(async () => {
      share.closeSheet();
      await Promise.resolve();
    });
    expect(share.files.size).toBe(0);
    // No analytics event, no queue entry (DS-7).
    expect(analytics.queuedCount()).toBe(queued);
  }, 180_000);

  it('shows the export error when the sheet is unavailable', async () => {
    const share = createTestShare();
    share.available = false;
    await renderScreen({ share });
    await runGoldens();
    await fireEvent.press(screen.getByTestId('diagnostics.ram.ge-12gb'));
    await fireEvent.press(screen.getByTestId('diagnostics.class.reference-class'));
    await fireEvent.press(screen.getByTestId('diagnostics.share'));
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics.share.error')).toBeTruthy();
    });
    expect(share.writes).toBe(0);
  }, 180_000);

  it('cancels a run at the next case and keeps nothing', async () => {
    const held = heldYield();
    await renderScreen({ yieldToUi: held.yieldToUi });
    await fireEvent.press(screen.getByTestId('diagnostics.runAll'));
    const progress = screen.getByTestId('diagnostics.progress');
    expect(progress.props.accessibilityLiveRegion).toBe('polite');
    expect(progress.props.children).toMatch(/^Engine and bot reference results · 1 of \d+$/);
    await fireEvent.press(screen.getByTestId('diagnostics.cancel'));
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics.ended').props.children).toBe(
        'Run cancelled. Nothing was kept.',
      );
    });
    expect(screen.getByTestId('diagnostics.status.goldens').props.children).toBe('– Not run');
  });

  it('stops the run when the app leaves the foreground', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler;
      return { remove: () => undefined };
    });
    const held = heldYield();
    await renderScreen({ yieldToUi: held.yieldToUi });
    await fireEvent.press(screen.getByTestId('diagnostics.runAll'));
    await act(async () => {
      listener?.('background');
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics.ended').props.children).toBe(
        'The app went to the background, so the run stopped. Run it again.',
      );
    });
  });

  it('Close cancels and leaves', async () => {
    const { onClose } = await renderScreen();
    await fireEvent.press(screen.getByTestId('diagnostics.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
