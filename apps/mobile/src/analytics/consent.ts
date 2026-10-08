/**
 * The tester's analytics choices (E-1.5 Q-7, design §5.4, §5.8): consent (default on: enrollment consent comes first)
 * and whether the first-run notice was seen. One record in the backup-excluded data directory, replaced atomically.
 * It is not purged with the queue: it is what remembers "off".
 *
 * A missing file is a first launch (the defaults). A file that exists but cannot be read is treated as consent off
 * and notice seen: when the choice is unknown, the app records nothing rather than override a possible "off".
 */
import type { DataStore } from '../persistence/data-store';
import { asciiJson } from '../persistence/match-journal';

export const CONSENT_FILE = 'analytics.consent';

export interface AnalyticsChoices {
  readonly consent: boolean;
  readonly noticeSeen: boolean;
}

export const DEFAULT_CHOICES: AnalyticsChoices = { consent: true, noticeSeen: false };
const UNKNOWN_CHOICES: AnalyticsChoices = { consent: false, noticeSeen: true };

export function readChoices(store: DataStore): AnalyticsChoices {
  let read;
  try {
    read = store.read(CONSENT_FILE, 256);
  } catch {
    return UNKNOWN_CHOICES;
  }
  if (read.kind === 'missing') return DEFAULT_CHOICES;
  if (read.kind !== 'ok' || read.records.length !== 1) return UNKNOWN_CHOICES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.records[0] ?? '') as unknown;
  } catch {
    return UNKNOWN_CHOICES;
  }
  if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_CHOICES;
  const { v, consent, noticeSeen } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof consent !== 'boolean' || typeof noticeSeen !== 'boolean') {
    return UNKNOWN_CHOICES;
  }
  return { consent, noticeSeen };
}

/** True once the choice is on disk. */
export function writeChoices(store: DataStore, choices: AnalyticsChoices): boolean {
  try {
    store.replace(CONSENT_FILE, [asciiJson({ v: 1, ...choices })]);
    return true;
  } catch {
    return false;
  }
}
