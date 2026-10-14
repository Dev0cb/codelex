/**
 * React wiring of the playtest recorder (slice S6a). The provider sits outside the lexicon gate so the session marker
 * is written at launch, before anything that could crash at boot (`session-marker.ts` contract step 1). In one
 * effect it starts the recorder, subscribes to `AppState` and, in the same tick, feeds `AppState.currentState`
 * (step 2); the queue loads once the JS thread is idle after the first render (`requestIdleCallback`, bounded by a
 * timeout; `InteractionManager` is only a deprecated stub in RN 0.86). `<InteractiveMark />` inside the gate marks the first route as
 * rendered, which releases the cold `app_opened`.
 *
 * Features emit through the S5 seam (`emitter.ts`: `useAnalytics().emit({ event, properties })`); this provider plugs
 * the recorder into that context. The analytics surfaces (Home notice, Settings) use `usePlaytestAnalytics()` and
 * `useAnalyticsSnapshot()`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useFlag } from '../config/flags-provider';
import { deviceAnalytics } from './device-analytics';
import { AnalyticsContext } from './emitter';
import type { AnalyticsSnapshot, PlaytestAnalytics } from './recorder';

interface IdleScheduler {
  requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** Longest wait for an idle moment before the queue loads anyway. */
const LOAD_IDLE_TIMEOUT_MS = 2000;

/** Runs `task` when the JS thread is idle (or on the next tick where that API is missing); returns a cancel. */
export function whenIdle(task: () => void): () => void {
  const scheduler = globalThis as IdleScheduler;
  if (typeof scheduler.requestIdleCallback === 'function') {
    const handle = scheduler.requestIdleCallback(task, { timeout: LOAD_IDLE_TIMEOUT_MS });
    return () => {
      scheduler.cancelIdleCallback?.(handle);
    };
  }
  const timer = setTimeout(task, 0);
  return () => {
    clearTimeout(timer);
  };
}

/** Creates the recorder for the flag value (tests inject one on an in-memory disk). */
export type CreateAnalytics = (enabled: boolean) => PlaytestAnalytics;

export const CreateAnalyticsContext = createContext<CreateAnalytics>(deviceAnalytics);

const PlaytestAnalyticsContext = createContext<PlaytestAnalytics | null>(null);

export function AnalyticsProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const enabled = useFlag('analytics.upload.enabled');
  const create = useContext(CreateAnalyticsContext);
  const [analytics] = useState(() => create(enabled));

  useEffect(() => {
    analytics.start();
    const subscription = AppState.addEventListener('change', analytics.onAppState);
    analytics.onAppState(AppState.currentState);
    const cancelLoad = whenIdle(() => {
      analytics.load();
    });
    return () => {
      cancelLoad();
      subscription.remove();
    };
  }, [analytics]);

  return (
    <PlaytestAnalyticsContext value={analytics}>
      <AnalyticsContext value={analytics}>{children}</AnalyticsContext>
    </PlaytestAnalyticsContext>
  );
}

/** The recorder (consent, notice, queue counts); null outside the provider (screens tested on their own). */
export function usePlaytestAnalytics(): PlaytestAnalytics | null {
  return useContext(PlaytestAnalyticsContext);
}

const OFF: AnalyticsSnapshot = {
  enabled: false,
  consent: false,
  noticeVisible: false,
  installId: null,
};
const noSubscription = (): (() => void) => () => undefined;
const offSnapshot = (): AnalyticsSnapshot => OFF;

/** What the analytics surfaces show; everything hidden outside the provider. */
export function useAnalyticsSnapshot(): AnalyticsSnapshot {
  const analytics = usePlaytestAnalytics();
  return useSyncExternalStore(
    analytics?.subscribe ?? noSubscription,
    analytics?.getSnapshot ?? offSnapshot,
  );
}

/** Rendered once the first route is mounted (inside the lexicon gate): the cold start is over. */
export function InteractiveMark(): null {
  const analytics = usePlaytestAnalytics();
  useEffect(() => {
    analytics?.markInteractive();
  }, [analytics]);
  return null;
}
