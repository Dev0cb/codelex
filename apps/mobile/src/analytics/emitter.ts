/**
 * The seam between features and the analytics recorder (AC-17). Features emit a catalogue event (name and
 * properties, typed by `events.ts`); the recorder (slice S6a: consent, envelope, validation, queue) plugs in through
 * {@link AnalyticsContext}. Until it does, the default emitter drops every event, so a feature can ship its events
 * before the queue exists. Type-only import of the schemas: this module adds no zod code to the bundle.
 */
import { createContext, useContext } from 'react';

import type { EventName, EventProperties } from './events';

/** One event as data, discriminated by `event`. */
export type AnalyticsCall<N extends EventName = EventName> = {
  [K in N]: { readonly event: K; readonly properties: EventProperties<K> };
}[N];

export interface AnalyticsEmitter {
  /** Records one event (S6a validates it and fills the envelope); must never throw into the caller. */
  emit(call: AnalyticsCall): void;
}

/** Drops every event (no recorder yet, tests, previews). */
export const NOOP_ANALYTICS: AnalyticsEmitter = { emit: () => undefined };

export const AnalyticsContext = createContext<AnalyticsEmitter>(NOOP_ANALYTICS);

/** The current emitter. */
export function useAnalytics(): AnalyticsEmitter {
  return useContext(AnalyticsContext);
}
