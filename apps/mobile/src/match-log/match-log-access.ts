/**
 * What the "Send match log" UI may do with the saved matches (slice S6d): find which match it would export, and
 * build the file text for it. Nothing else of the data directory is reachable from here (TM-04 allowlist). Provided
 * by the match session (which owns the data directory); null where no persistence exists (screens tested alone).
 */
import type { Result } from '@codelex/config/result';
import type { EngineContext } from '@codelex/game-engine';
import { createContext, useContext } from 'react';

import type { DataStore } from '../persistence/data-store';
import {
  buildMatchLogFile,
  findMatchLog,
  type MatchLogApp,
  type MatchLogBuildOptions,
  type MatchLogFileError,
  type MatchLogScope,
} from './match-log-file';

export interface MatchLogAccess {
  /** The match the file would hold, or null (`matchlog.empty`). A disk error counts as nothing to export. */
  find(): MatchLogScope | null;
  /** The file text for `scope`, read from disk now. Never throws. */
  build(scope: MatchLogScope): Result<string, MatchLogFileError>;
}

/**
 * @param app The exporting build, or null when the platform is neither iOS nor Android (then nothing is built).
 * @param corrupt The resume's verdict when it found `current.log` unusable (the corrupt card, including the D-1 crash
 *   counter firing): that log is then exported with this divergence and never replayed (TM-04).
 */
export function createMatchLogAccess(
  store: DataStore,
  ctx: EngineContext,
  app: MatchLogApp | null,
  corrupt: MatchLogBuildOptions['corrupt'] = null,
): MatchLogAccess {
  return {
    find() {
      try {
        return findMatchLog(store);
      } catch {
        return null;
      }
    },
    build(scope) {
      if (app === null) return { ok: false, error: { code: 'INVALID' } };
      return buildMatchLogFile(store, scope, app, ctx, { corrupt });
    },
  };
}

export const MatchLogContext = createContext<MatchLogAccess | null>(null);

export function useMatchLogAccess(): MatchLogAccess | null {
  return useContext(MatchLogContext);
}
