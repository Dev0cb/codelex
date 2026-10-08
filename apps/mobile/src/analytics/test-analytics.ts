/**
 * Test support (not shipped: nothing in the app imports it). A recorder on an in-memory disk with fixed clocks and
 * deterministic v4 ids, for screen and provider tests.
 */
import type { FsPrimitives } from '../persistence/data-store';
import { PlaytestAnalytics } from './recorder';

export const TEST_NOW = Date.parse('2026-10-07T09:30:00.000Z');

export function createTestAnalytics(fs: FsPrimitives, enabled: boolean): PlaytestAnalytics {
  let n = 0;
  return new PlaytestAnalytics(
    {
      fs,
      randomUUID: () => {
        n += 1;
        return `11111111-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
      },
      wallMs: () => TEST_NOW,
      monoMs: () => 0,
      sinceProcessStartMs: () => 1200,
      context: () => ({ app_version: '0.1.0', platform: 'android', locale: 'en-US' }),
    },
    enabled,
  );
}
