/**
 * The provider follows the `session-marker.ts` S6a contract: start at mount, subscribe to `AppState` and feed the
 * current state in the same tick, load the queue when idle after the first render; `InteractiveMark` releases the
 * cold `app_opened`; features emit through the S5 seam (`emitter.ts`).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { useEffect, type JSX } from 'react';
import { AppState, Text } from 'react-native';

import { FlagsProvider } from '../config/flags-provider';
import { DataStore } from '../persistence/data-store';
import { MemoryFs } from '../persistence/memory-fs';
import {
  AnalyticsProvider,
  CreateAnalyticsContext,
  InteractiveMark,
  useAnalyticsSnapshot,
  whenIdle,
} from './analytics-provider';
import { useAnalytics } from './emitter';
import { EventQueue } from './event-queue';
import { SESSION_MARKER_FILE } from './session-marker';
import { createTestAnalytics, TEST_NOW } from './test-analytics';

/** A feature emitting through the S5 seam (`emitter.ts`) at mount, before the provider's own effect runs. */
function Emit(): null {
  const analytics = useAnalytics();
  useEffect(() => {
    analytics.emit({ event: 'app_backgrounded', properties: { foreground_ms: 42 } });
  }, [analytics]);
  return null;
}

function Id(): JSX.Element {
  return <Text testID="id">{useAnalyticsSnapshot().installId ?? 'none'}</Text>;
}

const queued = (fs: MemoryFs) =>
  new EventQueue(new DataStore(fs.reboot()), () => TEST_NOW).events();

function renderProvider(fs: MemoryFs, enabled: boolean) {
  return render(
    <FlagsProvider flags={{ 'analytics.upload.enabled': enabled }}>
      <CreateAnalyticsContext value={(on) => createTestAnalytics(fs, on)}>
        <AnalyticsProvider>
          <Id />
          <Emit />
          <InteractiveMark />
        </AnalyticsProvider>
      </CreateAnalyticsContext>
    </FlagsProvider>,
  );
}

describe('AnalyticsProvider', () => {
  it('subscribes to AppState and feeds the current state in the same tick', async () => {
    jest.useFakeTimers();
    const fs = new MemoryFs();
    // The RN Jest preset already mocks AppState.addEventListener (it returns a subscription).
    const { calls } = jest.mocked(AppState).addEventListener.mock;
    const view = await renderProvider(fs, true);
    expect(calls.map(([type]) => type)).toContain('change');
    // Written at launch (contract step 1), whatever the current state.
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(true);
    await act(() => {
      jest.runAllTimers();
    });
    // Recorded before the deferred queue load, written once it loaded.
    expect(queued(fs).map((e) => e.event)).toEqual(['app_backgrounded']);
    expect(view.getByTestId('id').props.children).toMatch(/^11111111-/);
    const handler = calls.at(-1)?.[1] as ((s: string) => void) | undefined;
    await act(() => {
      handler?.('active');
    });
    // Interactive already: the first move to the foreground is the cold start.
    expect(queued(fs).map((e) => e.event)).toEqual(['app_backgrounded', 'app_opened']);
    await act(() => {
      handler?.('background');
    });
    expect(fs.files.has(SESSION_MARKER_FILE)).toBe(false);
    await view.unmount();
    jest.useRealTimers();
  });

  it('does nothing at all with the flag off', async () => {
    const fs = new MemoryFs();
    const view = await renderProvider(fs, false);
    expect(fs.boundaries).toBe(0);
    expect(fs.reads).toEqual([]);
    expect(view.getByTestId('id').props.children).toBe('none');
  });

  it('keeps the no-op emitter and a hidden snapshot outside the provider', async () => {
    const view = await render(
      <>
        <Id />
        <Emit />
        <InteractiveMark />
      </>,
    );
    expect(view.getByTestId('id').props.children).toBe('none');
  });
});

describe('whenIdle', () => {
  it('uses requestIdleCallback with a timeout when the runtime has it, and cancels', () => {
    const scheduler = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const saved = [scheduler.requestIdleCallback, scheduler.cancelIdleCallback];
    const request = jest.fn<(task: () => void, options?: { timeout: number }) => number>(() => 7);
    const cancel = jest.fn();
    scheduler.requestIdleCallback = request;
    scheduler.cancelIdleCallback = cancel;
    const task = jest.fn();
    whenIdle(task)();
    expect(request).toHaveBeenCalledWith(task, { timeout: 2000 });
    expect(cancel).toHaveBeenCalledWith(7);
    [scheduler.requestIdleCallback, scheduler.cancelIdleCallback] = saved;
  });

  it('falls back to the next tick, cancellable', () => {
    jest.useFakeTimers();
    const scheduler = globalThis as { requestIdleCallback?: unknown };
    const saved = scheduler.requestIdleCallback;
    scheduler.requestIdleCallback = undefined;
    const task = jest.fn();
    whenIdle(task);
    const cancelled = jest.fn();
    whenIdle(cancelled)();
    jest.runAllTimers();
    expect(task).toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
    scheduler.requestIdleCallback = saved;
    jest.useRealTimers();
  });
});
