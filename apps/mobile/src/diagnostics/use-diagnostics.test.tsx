/**
 * DG1 note §5.1: the run hook. A run that rejects (outside a case: the settle delay, a yield, a result) ends as
 * `failed` and can be started again; only the app going to the background interrupts a run (iOS `inactive`, for a
 * notification shade or the app switcher peek, does not); nothing is set after the screen unmounts.
 */
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { loadBundledLexicon } from '../match/test-support';
import { runtimeCheck } from './device-info';
import { createScratchStore } from './scratch-fs';
import { useDiagnosticsRun, type DiagnosticsDeps } from './use-diagnostics';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** A settle delay the test releases (or rejects) by hand. */
function heldSettle(): { settle: () => Promise<void>; release: () => void; fail: () => void } {
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  return {
    settle: () =>
      new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    release: () => resolve?.(),
    fail: () => reject?.(new Error('settle failed')),
  };
}

function deps(settle: () => Promise<void>): DiagnosticsDeps {
  let t = 0;
  return {
    lexicon: lexicon.index,
    clock: () => (t += 0.01),
    store: createScratchStore(),
    runtime: runtimeCheck(undefined, false),
    yieldToUi: () => Promise.resolve(),
    settle,
    sizes: { hasBatches: 1, applyPasses: 1 },
  };
}

function captureAppState(): { emit: (state: AppStateStatus) => void } {
  let listener: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler;
    return { remove: () => undefined };
  });
  return { emit: (state) => listener?.(state) };
}

describe('useDiagnosticsRun', () => {
  it('a rejecting run ends as failed, resets running and can start again', async () => {
    const held = heldSettle();
    const { result } = await renderHook(() => useDiagnosticsRun(deps(held.settle)));
    await act(async () => {
      result.current.start(['micro']);
      await Promise.resolve();
    });
    expect(result.current.state.phase).toBe('running');
    await act(async () => {
      held.fail();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('failed');
    });
    expect(result.current.state.suite).toBeNull();
    // `running` was reset: a new run starts.
    await act(async () => {
      result.current.start(['micro']);
      await Promise.resolve();
    });
    expect(result.current.state.phase).toBe('running');
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('done');
    });
  });

  it('iOS inactive does not cancel the run; background interrupts it', async () => {
    const appState = captureAppState();
    const held = heldSettle();
    const { result } = await renderHook(() => useDiagnosticsRun(deps(held.settle)));
    await act(async () => {
      result.current.start(['micro']);
      await Promise.resolve();
    });
    await act(async () => {
      appState.emit('inactive');
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('done');
    });
    expect(result.current.state.results.micro).toBeDefined();

    await act(async () => {
      result.current.start(['micro']);
      await Promise.resolve();
    });
    await act(async () => {
      appState.emit('background');
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('interrupted');
    });
  });

  it('sets no state after unmount (closing the modal mid-run)', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const held = heldSettle();
    const settled = jest.fn<() => void>();
    const { result, unmount } = await renderHook(() =>
      useDiagnosticsRun(
        deps(() =>
          held.settle().finally(() => {
            settled();
          }),
        ),
      ),
    );
    await act(async () => {
      result.current.start(['micro']);
      await Promise.resolve();
    });
    await unmount();
    await act(async () => {
      held.fail();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
