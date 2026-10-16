import { useRouter } from 'expo-router';
import { useMemo, useState, type JSX } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalyticsSnapshot, usePlaytestAnalytics } from '../../analytics/analytics-provider';
import { PLAYTEST_FILE_NAME } from '../../analytics/playtest-file';
import type { ExportTicket } from '../../analytics/recorder';
import { QUEUE_CAP } from '../../analytics/event-queue';
import { APP_BUILD } from '../../config/build-info';
import { resolveExportAddress } from '../../config/export-address';
import { useI18n } from '../../i18n/i18n-provider';
import { shareTextFile } from '../../sharing/share-file';
import { useShare } from '../../sharing/share-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { TopBar } from '../../ui/top-bar';
import { ConfirmSheet } from '../match/match-sheets';

/** System mono (D-28): tester ID and the example event. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** Text presentation (no emoji glyph); decorative, hidden from screen readers (the row text says it all). */
const CHECK_GLYPH = '✓';
const CROSS_GLYPH = '✕';

const INCLUDED = [
  'export.summary.item.sessions',
  'export.summary.item.matches',
  'export.summary.item.words',
  'export.summary.item.rejections',
  'export.summary.item.cards',
  'export.summary.item.survey',
  'export.summary.item.technical',
] as const;

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sharing' }
  /** The sheet closed: "Did you send the file?" */
  | { readonly kind: 'confirm'; readonly ticket: ExportTicket }
  /** "Yes" was tapped but the clear could not be saved (full disk). */
  | { readonly kind: 'clear_error'; readonly count: number; readonly remaining: number };

type Status =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly which: 'file' | 'share' }
  /** `remaining`: what the confirmed file left out (its `remaining`), not the live queue count. */
  | { readonly kind: 'done'; readonly count: number; readonly remaining: number };

/** A day in the tester's language ("3 Oct" / "3 oct."); ISO date where `Intl` is missing. */
export function formatDay(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Send playtest data (E-1.5 design §5.9, AC-17; slice S6c), behind `analytics.upload.enabled` (the route redirects
 * Home when it is off).
 *
 * - On open: what the file holds from queue counts only (no event parsed, instant on low-end phones), the fixed
 *   included/excluded lists, the tester ID, the email notice, the drop warning, and the optional suggested address
 *   (TM-07: a build constant; hidden while none is configured).
 * - "Share file…" builds the file then (oldest events that fit in 1 MB), writes it to the cache share directory,
 *   opens the OS share sheet, and deletes the file when it closes (TM-04, `share-file.ts`).
 * - Then always "Did you send the file?": "Yes, I sent it" clears exactly that file's events and records
 *   `analytics_buffer_flushed`; "Not yet" changes nothing. With events left over (a full queue needs about three
 *   files), the screen says how many the file left out (its `remaining`, not the live queue) and Share sends the
 *   next file. A clear that cannot be saved says so, with Try again.
 * No animation of its own; the sheet fades under reduced motion (`Sheet`). Text scales to 200 %: everything wraps
 * and the screen scrolls.
 */
export function SendDataScreen(): JSX.Element {
  const { t, locale } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  const router = useRouter();
  const analytics = usePlaytestAnalytics();
  const snapshot = useAnalyticsSnapshot();
  const share = useShare();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const [sampleOpen, setSampleOpen] = useState(false);
  const recording = snapshot.consent && snapshot.installId !== null;

  // Counts only; read again after every confirmed export (`exports`) and consent change.
  const summary = useMemo(
    () => (recording ? (analytics?.exportSummary() ?? null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `exports` invalidates the counts on purpose.
    [analytics, recording, snapshot.exports],
  );
  const sample = useMemo(
    () => (sampleOpen && recording ? (analytics?.exportSample() ?? null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `exports` invalidates the sample on purpose.
    [analytics, recording, sampleOpen, snapshot.exports],
  );
  const address = resolveExportAddress(undefined);
  const events = summary?.events ?? 0;
  const busy = phase.kind !== 'idle';

  const onShare = async (): Promise<void> => {
    if (analytics === null || busy) return;
    setStatus({ kind: 'none' });
    const prepared = analytics.prepareExport(APP_BUILD);
    if (!prepared.ok) {
      // `off`/`empty` cannot be tapped (Share is disabled); `invalid` is a bug, shown as a file error.
      if (prepared.reason === 'invalid') setStatus({ kind: 'error', which: 'file' });
      return;
    }
    setPhase({ kind: 'sharing' });
    const outcome = await shareTextFile(share, {
      name: PLAYTEST_FILE_NAME,
      text: prepared.file.text,
      mimeType: 'application/json',
      uti: 'public.json',
      title: t('export.title'),
    });
    if (outcome === 'closed') {
      setPhase({ kind: 'confirm', ticket: prepared.ticket });
      return;
    }
    setPhase({ kind: 'idle' });
    setStatus({ kind: 'error', which: outcome === 'file_error' ? 'file' : 'share' });
  };

  const onSent = (): void => {
    if (analytics === null || phase.kind !== 'confirm') return;
    const { eventsSent: count, remaining } = phase.ticket;
    if (analytics.confirmSent(phase.ticket)) {
      setPhase({ kind: 'idle' });
      setStatus({ kind: 'done', count, remaining });
    } else {
      setPhase({ kind: 'clear_error', count, remaining });
    }
  };

  const onRetryClear = (): void => {
    if (analytics === null || phase.kind !== 'clear_error') return;
    if (analytics.retryClear()) {
      setStatus({ kind: 'done', count: phase.count, remaining: phase.remaining });
      setPhase({ kind: 'idle' });
    }
  };

  const text = (key: Parameters<typeof t>[0], muted = false, testID?: string): JSX.Element => (
    <Text
      testID={testID}
      style={[type.body, { color: muted ? color.textMuted : color.textPrimary }]}
    >
      {t(key)}
    </Text>
  );
  const sectionTitle = (title: string): JSX.Element => (
    <Text
      accessibilityRole="header"
      style={[type.caption, styles.caps, { color: color.textMuted }]}
    >
      {title}
    </Text>
  );
  const listRow = (glyph: string, label: string, key: string): JSX.Element => (
    <View key={key} style={[styles.row, { gap: space[2] }]}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[type.body, { color: color.textMuted }]}
      >
        {glyph}
      </Text>
      <Text style={[type.body, styles.grow, { color: color.textPrimary }]}>{label}</Text>
    </View>
  );
  const card = {
    borderRadius: radius.card,
    borderColor: color.borderSubtle,
    backgroundColor: color.bgSurface,
    padding: space[4],
    gap: space[3],
  };

  let body: JSX.Element;
  if (!recording) {
    body = (
      <View testID="export.off" style={{ gap: space[4] }}>
        {text('export.off')}
        <Button
          testID="export.off.action"
          label={t('export.off.action')}
          onPress={() => {
            router.dismissTo('/settings');
          }}
        />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space[5] }}>
        {text('export.intro')}
        {address !== null && (
          <Text
            testID="export.recipient"
            selectable
            style={[type.body, { color: color.textPrimary }]}
          >
            {t('export.recipient', { address })}
          </Text>
        )}
        <View testID="export.summary" style={[styles.bordered, card]}>
          {sectionTitle(t('export.summary.title'))}
          {summary !== null && summary.oldestMs !== null && summary.newestMs !== null ? (
            <Text
              testID="export.summary.counts"
              style={[type.body, styles.tabular, { color: color.textPrimary }]}
            >
              {t('export.summary.counts', {
                events: summary.events,
                matches: summary.matches,
                from: formatDay(summary.oldestMs, locale),
                to: formatDay(summary.newestMs, locale),
              })}
            </Text>
          ) : (
            text('export.empty', true, 'export.empty')
          )}
          {INCLUDED.map((key) => listRow(CHECK_GLYPH, t(key), key))}
        </View>
        <View testID="export.excluded" style={[styles.bordered, card]}>
          {sectionTitle(t('export.excluded.title'))}
          {listRow(CROSS_GLYPH, t('export.excluded.body'), 'excluded')}
        </View>
        <Text
          testID="export.installId"
          selectable
          style={[type.body, styles.mono, { color: color.textPrimary }]}
        >
          {t('export.id_line', { id: snapshot.installId })}
        </Text>
        {text('export.email_notice', true)}
        {summary !== null && summary.dropped.queueCap > 0 && (
          <Text testID="export.dropped" style={[type.body, { color: color.feedbackWarning }]}>
            {t('export.dropped', { count: summary.dropped.queueCap, max: QUEUE_CAP })}
          </Text>
        )}
        <View style={{ gap: space[3] }}>
          <Pressable
            testID="export.sample.toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: sampleOpen, disabled: events === 0 }}
            disabled={events === 0}
            onPress={() => {
              setSampleOpen((open) => !open);
            }}
            style={[styles.row, { minHeight: layout.touchMin, gap: space[2] }]}
          >
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[type.body, { color: color.textMuted }]}
            >
              {sampleOpen ? '▾' : '▸'}
            </Text>
            <Text
              style={[type.body, { color: events === 0 ? color.textMuted : color.textPrimary }]}
            >
              {t('export.sample.toggle')}
            </Text>
          </Pressable>
          {sample !== null && (
            <Text
              testID="export.sample"
              selectable
              style={[
                type.caption,
                styles.mono,
                card,
                styles.bordered,
                { color: color.textPrimary },
              ]}
            >
              {JSON.stringify(sample, null, 2)}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <TopBar
        testID="export"
        title={t('export.title')}
        onBack={() => {
          router.back();
        }}
      />
      <ScrollView contentContainerStyle={{ padding: layout.marginScreen, gap: space[5] }}>
        {body}
        {recording && (
          <View style={{ gap: space[3] }}>
            <View accessibilityLiveRegion="polite" style={{ gap: space[2] }}>
              {status.kind === 'error' && (
                <Text testID="export.error" style={[type.body, { color: color.feedbackError }]}>
                  {t(status.which === 'file' ? 'export.error.file' : 'export.error.share')}
                </Text>
              )}
              {status.kind === 'done' && (
                <Text testID="export.done" style={[type.body, { color: color.textPrimary }]}>
                  {t('export.done', { count: status.count })}
                </Text>
              )}
              {status.kind === 'done' && status.remaining > 0 && (
                <Text testID="export.remaining" style={[type.body, { color: color.textPrimary }]}>
                  {t('export.remaining', { count: status.remaining })}
                </Text>
              )}
              {phase.kind === 'clear_error' && (
                <Text
                  testID="export.clearError"
                  style={[type.body, { color: color.feedbackError }]}
                >
                  {t('export.clear_error')}
                </Text>
              )}
            </View>
            {phase.kind === 'clear_error' ? (
              <Button
                testID="export.clearRetry"
                variant="primary"
                label={t('common.retry')}
                onPress={onRetryClear}
              />
            ) : (
              <Button
                testID="export.share"
                variant="primary"
                label={status.kind === 'error' ? t('common.retry') : t('export.share')}
                accessibilityHint={events === 0 ? t('export.empty') : undefined}
                disabled={events === 0 || busy}
                onPress={() => {
                  void onShare();
                }}
              />
            )}
            {text('export.offline_hint', true)}
          </View>
        )}
      </ScrollView>
      <ConfirmSheet
        visible={phase.kind === 'confirm'}
        testID="export.confirm"
        title={t('export.confirm.title')}
        body={t('export.confirm.body')}
        cancelLabel={t('export.confirm.no')}
        confirmLabel={t('export.confirm.yes')}
        onCancel={() => {
          setPhase({ kind: 'idle' });
        }}
        onConfirm={onSent}
      >
        {phase.kind === 'confirm' && phase.ticket.remaining > 0 && (
          <Text testID="export.confirm.more" style={[type.body, { color: color.textMuted }]}>
            {t('export.confirm.more', { count: phase.ticket.remaining })}
          </Text>
        )}
      </ConfirmSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  grow: { flex: 1 },
  bordered: { borderWidth: 1 },
  caps: { textTransform: 'uppercase' },
  mono: { fontFamily: MONO },
  tabular: { fontVariant: ['tabular-nums'] },
});
