/**
 * The one local match vs the bot (E-1.5 AC-11, AC-12; slice S3), shared by Home and the match screen. It owns the
 * live model and its persistence: every accepted action is written to the on-device log before the screen shows it
 * (Q7, TM-01), a snapshot is taken on `app_backgrounded`, and at start the saved match is checked after the first
 * render (TM-02: no parsing before the first render), so Home shows the resume card or a cannot-resume card.
 *
 * Without persistence (`MatchServices.persistence` absent, as in the S1/S2 screen tests) matches simply are not
 * saved and the Summary shows no "New to you" count. It also provides the "Send match log" access (slice S6d,
 * `match-log-access.ts`), null without persistence.
 */
import { createMatch, type EngineContext } from '@codelex/game-engine';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { usePlaytestAnalytics } from '../analytics/analytics-provider';
import { exportApp } from '../config/build-info';
import { useLexicon } from '../lexicon/lexicon-gate';
import { createMatchLogAccess, MatchLogContext } from '../match-log/match-log-access';
import {
  finishMatch,
  openSavedMatch,
  persistTransition,
  snapshotOnBackground,
  type SavedMatch,
} from '../persistence/saved-match';
import { reduceMatch, startModel, type MatchCommand, type MatchModel } from './match-model';
import { playMatchConfig } from './play-config';
import { MatchServicesContext } from './match-services';

/** `checking` until the saved match has been read (just after the first render). */
export type SavedStatus = { readonly kind: 'checking' } | SavedMatch;

export interface MatchSession {
  readonly saved: SavedStatus;
  /** The live match (in progress or just finished); null before the first PLAY NOW of the process. */
  readonly model: MatchModel | null;
  /** The engine refused the header of a new match (`match.start.error`). */
  readonly startFailed: boolean;
  /** The last write failed (`match.low_storage`), until a write succeeds or the player dismisses it. */
  readonly lowStorage: boolean;
  /** Increases each time a saved match is restored (the screen announces `match.resume.restored`). */
  readonly restored: number;
  /** Canonical terms of the finished match the player had never played on this device; null = no history. */
  readonly newToYou: ReadonlySet<string> | null;
  /** PLAY NOW: keep the live match, else resume the saved one, else start a new one. */
  readonly play: () => void;
  /** New match… (confirmed), "Start a new match" on a cannot-resume card, Play again: abandons and starts. */
  readonly startNew: () => void;
  readonly dispatch: (command: MatchCommand) => void;
  readonly dismissLowStorage: () => void;
}

const MatchSessionContext = createContext<MatchSession | null>(null);

const NONE: SavedMatch = { kind: 'none' };
const CHECKING: SavedStatus = { kind: 'checking' };

/** The session; null outside {@link MatchSessionProvider} (screens tested on their own). */
export function useMatchSession(): MatchSession | null {
  return useContext(MatchSessionContext);
}

export function MatchSessionProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { index } = useLexicon();
  const services = useContext(MatchServicesContext);
  const analytics = usePlaytestAnalytics();
  const ctx = useMemo<EngineContext>(() => ({ lexicon: index }), [index]);
  const persistence = useMemo(() => services.persistence?.() ?? null, [services]);
  // "Send match log" (slice S6d) reads the saved matches through this allowlist only (TM-04).
  const matchLog = useMemo(
    () => (persistence === null ? null : createMatchLogAccess(persistence.store, ctx, exportApp())),
    [persistence, ctx],
  );

  const [saved, setSaved] = useState<SavedStatus>(persistence === null ? NONE : CHECKING);
  const [model, setModel] = useState<MatchModel | null>(null);
  const modelRef = useRef<MatchModel | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const [lowStorage, setLowStorage] = useState(false);
  const [restored, setRestored] = useState(0);
  const [newToYou, setNewToYou] = useState<ReadonlySet<string> | null>(null);

  const show = useCallback((next: MatchModel | null) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  // TM-02: the saved match is read after the first render, never before it.
  useEffect(() => {
    if (persistence === null) return;
    const timer = setTimeout(() => {
      setSaved(openSavedMatch(persistence, ctx));
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [persistence, ctx]);

  // Q7: a snapshot when the app goes to the background, so the next cold start resumes quickly.
  useEffect(() => {
    if (persistence === null) return;
    const subscription = AppState.addEventListener('change', (next) => {
      const current = modelRef.current;
      if (next === 'background' && current !== null) {
        snapshotOnBackground(persistence.journal, current.state);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [persistence]);

  const startNew = useCallback(() => {
    persistence?.journal.abandon();
    setSaved(NONE);
    setNewToYou(null);
    const config = playMatchConfig(services.newSeed(), index);
    const created = createMatch(config, ctx);
    if (!created.ok) {
      setStartFailed(true);
      show(null);
      return;
    }
    setStartFailed(false);
    if (persistence !== null) setLowStorage(!persistence.journal.start(config));
    show(startModel(created.value.state));
  }, [persistence, services, index, ctx, show]);

  const play = useCallback(() => {
    if (modelRef.current?.state.status === 'in_progress') return;
    if (saved.kind === 'resumable') {
      setSaved(NONE);
      setNewToYou(null);
      setStartFailed(false);
      setRestored((n) => n + 1);
      show(saved.model);
      return;
    }
    startNew();
  }, [saved, show, startNew]);

  const dispatch = useCallback(
    (command: MatchCommand) => {
      const current = modelRef.current;
      if (current === null) return;
      const next = reduceMatch(current, command, ctx);
      if (next === current) return;
      if (persistence !== null) {
        // Written before the move is shown (Q7, TM-01); on failure play continues from memory.
        const outcome = persistTransition(persistence.journal, current, next, ctx);
        if (outcome === 'failed') setLowStorage(true);
        if (outcome === 'saved') setLowStorage(false);
        if (current.state.status !== 'finished' && next.state.status === 'finished') {
          setNewToYou(finishMatch(persistence, next));
        }
      }
      // D-17: the export prompt counts matches completed this session (slice S6c).
      if (current.state.status !== 'finished' && next.state.status === 'finished') {
        analytics?.noteMatchCompleted();
      }
      show(next);
    },
    [analytics, ctx, persistence, show],
  );

  const dismissLowStorage = useCallback(() => {
    setLowStorage(false);
  }, []);

  const value = useMemo<MatchSession>(
    () => ({
      saved,
      model,
      startFailed,
      lowStorage,
      restored,
      newToYou,
      play,
      startNew,
      dispatch,
      dismissLowStorage,
    }),
    [
      saved,
      model,
      startFailed,
      lowStorage,
      restored,
      newToYou,
      play,
      startNew,
      dispatch,
      dismissLowStorage,
    ],
  );
  return (
    <MatchSessionContext value={value}>
      <MatchLogContext value={matchLog}>{children}</MatchLogContext>
    </MatchSessionContext>
  );
}
