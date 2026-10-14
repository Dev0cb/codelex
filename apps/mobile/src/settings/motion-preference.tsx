/**
 * The Settings "Animations" choice (E-1.5 D-22, design §5.8): follow the OS reduced-motion setting (default), or force
 * reduced or full motion. Not an analytics row: it is not behind `analytics.upload.enabled`. Stored as one record in
 * the shared data directory (`settings.prefs`), read after the first render; until then the OS setting applies.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { DataStore, type FsPrimitives } from '../persistence/data-store';
import { createDeviceFs } from '../persistence/device-fs';
import { asciiJson } from '../persistence/match-journal';

export const SETTINGS_FILE = 'settings.prefs';

export const MOTION_PREFERENCES = ['system', 'reduced', 'full'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

const isPreference = (value: unknown): value is MotionPreference =>
  typeof value === 'string' && (MOTION_PREFERENCES as readonly string[]).includes(value);

export function readMotionPreference(store: DataStore): MotionPreference {
  try {
    store.recover((name) => name === SETTINGS_FILE);
    const read = store.read(SETTINGS_FILE, 256);
    if (read.kind !== 'ok' || read.records.length !== 1) return 'system';
    const parsed = JSON.parse(read.records[0] ?? '') as unknown;
    const motion =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['motion']
        : undefined;
    return isPreference(motion) ? motion : 'system';
  } catch {
    return 'system';
  }
}

export function writeMotionPreference(store: DataStore, motion: MotionPreference): boolean {
  try {
    store.replace(SETTINGS_FILE, [asciiJson({ v: 1, motion })]);
    return true;
  } catch {
    return false;
  }
}

export interface MotionPreferenceValue {
  readonly preference: MotionPreference;
  /** False when it could not be saved (`settings.save_error`); the choice still applies to this process. */
  readonly setPreference: (next: MotionPreference) => boolean;
}

const MotionPreferenceContext = createContext<MotionPreferenceValue>({
  preference: 'system',
  setPreference: () => false,
});

export function useMotionPreference(): MotionPreferenceValue {
  return useContext(MotionPreferenceContext);
}

export interface MotionPreferenceProviderProps {
  /** The data directory; default: the device's. */
  readonly fs?: FsPrimitives;
  readonly children: ReactNode;
}

export function MotionPreferenceProvider({
  fs,
  children,
}: MotionPreferenceProviderProps): JSX.Element {
  const store = useMemo(() => new DataStore(fs ?? createDeviceFs()), [fs]);
  const [preference, setState] = useState<MotionPreference>('system');

  // Read after the first render (like the saved match, TM-02): start-up never waits for this file.
  useEffect(() => {
    const timer = setTimeout(() => {
      setState(readMotionPreference(store));
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [store]);

  const setPreference = useCallback(
    (next: MotionPreference) => {
      setState(next);
      return writeMotionPreference(store, next);
    },
    [store],
  );

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <MotionPreferenceContext value={value}>{children}</MotionPreferenceContext>;
}
