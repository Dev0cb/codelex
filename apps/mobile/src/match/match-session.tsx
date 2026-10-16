/**
 * The one local match vs the bot (E-1.5 AC-11, AC-12; slice S3), shared by Home and the match screen. It owns the
 * live model and its persistence: every accepted action is written to the on-device log before the screen shows it
 * (Q7, TM-01), a snapshot is taken on `app_backgrounded`, and at start the saved match is checked after the first
 * render (TM-02: no parsing before the first render), so Home shows the resume card or a cannot-resume card.
 *
 * Gameplay analytics (sprint 4 EV, `match-telemetry.ts`): each call is queued and run by an effect once React has
 * committed the change, so analytics never delays a move; nothing happens unless the recorder is recording.
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
import { useFlag } from '../config/flags-provider';
import { useLexicon } from '../lexicon/lexicon-gate';
import { createMatchLogAccess, MatchLogContext } from '../match-log/match-log-access';
import { FILES } from '../persistence/match-journal';
import {
  finishMatch,
  openSavedMatch,
  persistTransition,
  snapshotOnBackground,
  type SavedMatch,
} from '../persistence/saved-match';
import { TERMS_FILE } from '../persistence/terms-seen';
import { reduceMatch, startModel, type MatchCommand, type MatchModel } from './match-model';
import { MatchTelemetry, type SummaryAction } from './match-telemetry';
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
  /** The analytics monotonic clock (ms), for the bot's timing (`bot_decision_made`); 0 without analytics. */
  readonly now: () => number;
  /** The Summary is on screen (`shown`), or one of its actions was tapped (`match_summary_action`). */
  readonly noteSummary: (event: 'shown' | SummaryAction) => void;
}

const MatchSessionContext = createContext<MatchSession | null>(null);

const NONE: SavedMatch = { kind: 'none' };
const NO_CLOCK = (): number => 0;
const CHECKING: SavedStatus = { kind: 'checking' };

/** The session; null outside {@link MatchSessionProvider} (screens tested on their own). */
export function useMatchSession(): MatchSession | null {
  return useContext(MatchSessionContext);
}

export function MatchSessionProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { index } = useLexicon();
  const services = useContext(MatchServicesContext);
  const analytics = usePlaytestAnalytics();
  const surveyEnabled = useFlag('playtest.survey.enabled');
  const ctx = useMemo<EngineContext>(() => ({ lexicon: index }), [index]);
  const persistence = useMemo(() => services.persistence?.() ?? null, [services]);
  const [saved, setSaved] = useState<SavedStatus>(persistence === null ? NONE : CHECKING);
  const [model, setModel] = useState<MatchModel | null>(null);
  const modelRef = useRef<MatchModel | null>(null);
  // "Send match log" (slice S6d) reads the saved matches through this allowlist only (TM-04). On the corrupt card
  // it reuses the resume's verdict, so the log whose replay may have crashed the app is never replayed again. The
  // live or resumable match tells, without a read, whether `current.log` has any action yet (§12.3).
  // Only 0 versus some actions matters, so the access is not rebuilt on every move.
  const known =
    model?.actions.length ?? (saved.kind === 'resumable' ? saved.model.actions.length : null);
  const currentActions = known === null ? null : Math.min(known, 1);
  const matchLog = useMemo(() => {
    if (persistence === null) return null;
    return createMatchLogAccess(persistence.store, ctx, exportApp(), {
      corrupt: saved.kind === 'state_corrupt' ? saved : null,
      currentActions: () => currentActions,
    });
  }, [persistence, ctx, saved, currentActions]);
  const [startFailed, setStartFailed] = useState(false);
  const [lowStorage, setLowStorage] = useState(false);
  const [restored, setRestored] = useState(0);
  const [newToYou, setNewToYou] = useState<ReadonlySet<string> | null>(null);

  // Sprint 4 EV: gameplay analytics, run after commit (see the module comment).
  const telemetry = useMemo(
    () => (analytics === null ? null : new MatchTelemetry(analytics, index)),
    [analytics, index],
  );
  const jobs = useRef<(() => void)[]>([]);
  const later = useCallback(
    (job: (t: MatchTelemetry) => void) => {
      if (telemetry !== null) {
        jobs.current.push(() => {
          job(telemetry);
        });
      }
    },
    [telemetry],
  );
  useEffect(() => {
    if (jobs.current.length === 0) return;
    const run = jobs.current;
    jobs.current = [];
    for (const job of run) job();
  });
  const hadHistory = useCallback((): boolean => {
    if (persistence === null) return false;
    try {
      return persistence.store.exists(FILES.last) || persistence.store.exists(TERMS_FILE);
    } catch {
      return false;
    }
  }, [persistence]);

  const show = useCallback((next: MatchModel | null) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  // TM-02: the saved match is read after the first render, never before it.
  useEffect(() => {
    if (persistence === null) return;
    const timer = setTimeout(() => {
      const before = telemetry?.now() ?? 0;
      const opened = openSavedMatch(persistence, ctx);
      const restoreMs = (telemetry?.now() ?? 0) - before;
      later((t) => {
        t.restored(opened, restoreMs);
      });
      setSaved(opened);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [persistence, ctx, telemetry, later]);

  // EV: background and foreground moves (active time, think time, `bot_match_resumed` from the background).
  useEffect(() => {
    if (telemetry === null) return;
    const subscription = AppState.addEventListener('change', (next) => {
      const current = modelRef.current;
      telemetry.appState(
        next,
        current !== null && current.state.status === 'in_progress' && current.failure === null
          ? current
          : null,
      );
    });
    return () => {
      subscription.remove();
    };
  }, [telemetry]);

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
    const previous = modelRef.current ?? (saved.kind === 'resumable' ? saved.model : null);
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
    const model = startModel(created.value.state);
    later((t) => {
      t.replaced(previous);
      t.started(model, hadHistory);
    });
    show(model);
  }, [persistence, services, index, ctx, show, saved, later, hadHistory]);

  const play = useCallback(() => {
    if (modelRef.current?.state.status === 'in_progress') return;
    if (saved.kind === 'resumable') {
      setSaved(NONE);
      setNewToYou(null);
      setStartFailed(false);
      setRestored((n) => n + 1);
      const resumed = saved.model;
      later((t) => {
        t.resumedSaved(resumed);
      });
      show(resumed);
      return;
    }
    startNew();
  }, [saved, show, startNew, later]);

  const dispatch = useCallback(
    (command: MatchCommand) => {
      const current = modelRef.current;
      if (current === null) return;
      const next = reduceMatch(current, command, ctx);
      if (next === current) return;
      const at = telemetry?.now() ?? 0;
      later((t) => {
        t.transition(current, next, command, at);
      });
      if (persistence !== null) {
        // Written before the move is shown (Q7, TM-01); on failure play continues from memory.
        const outcome = persistTransition(persistence.journal, current, next, ctx);
        if (outcome === 'failed') setLowStorage(true);
        if (outcome === 'saved') setLowStorage(false);
        if (current.state.status !== 'finished' && next.state.status === 'finished') {
          setNewToYou(finishMatch(persistence, next));
        }
      }
      // D-17: the export prompt counts matches completed this session (slice S6c); AC-18: the survey counts them
      // per install while it is active (slice S6b), before the Summary mounts and asks.
      if (current.state.status !== 'finished' && next.state.status === 'finished') {
        analytics?.noteMatchCompleted();
        if (surveyEnabled) analytics?.noteSurveyMatchCompleted();
      }
      show(next);
    },
    [analytics, ctx, persistence, show, surveyEnabled, telemetry, later],
  );

  const dismissLowStorage = useCallback(() => {
    setLowStorage(false);
  }, []);

  const noteSummary = useCallback(
    (event: 'shown' | SummaryAction) => {
      if (telemetry === null) return;
      if (event === 'shown') telemetry.summaryShown();
      else telemetry.summaryAction(event);
    },
    [telemetry],
  );
  const now = telemetry?.now ?? NO_CLOCK;

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
      now,
      noteSummary,
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
      now,
      noteSummary,
    ],
  );
  return (
    <MatchSessionContext value={value}>
      <MatchLogContext value={matchLog}>{children}</MatchLogContext>
    </MatchSessionContext>
  );
}
