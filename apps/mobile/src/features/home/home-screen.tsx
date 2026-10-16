import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type JSX } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalyticsSnapshot, usePlaytestAnalytics } from '../../analytics/analytics-provider';
import { useFlag } from '../../config/flags-provider';
import { useI18n } from '../../i18n/i18n-provider';
import type { MatchModel } from '../../match/match-model';
import { useMatchSession } from '../../match/match-session';
import { BOT_SEAT, HUMAN_SEAT } from '../../match/play-config';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { ConfirmSheet } from '../match/match-sheets';
import { AnalyticsNotice } from './analytics-notice';
import { ExportPromptCard } from './export-prompt-card';

/** System mono until a bundled mono face is decided (D-28): the resume card's scores. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** Settings gear (§5.2 top bar), text presentation (no emoji glyph); labelled by `home.settings.a11y`. */
const GEAR_GLYPH = '\u2699\ufe0e';

/**
 * Home (E-1.5 §5.2): the name, the tagline and one dominant action in the thumb zone.
 * - No match: PLAY NOW starts one (disabled for the instant the saved match is being read).
 * - Match in progress (AC-12, slice S3): the resume card is the primary action and PLAY NOW resumes it; "New match…"
 *   asks before abandoning it. It still works while `play_vs_bot.enabled` is off (AC-19).
 * - Saved match unusable (§5.10.2): the cannot-resume card replaces the resume card; "Start a new match" deletes it.
 * - `play_vs_bot.enabled` off: an inert paused card instead of starting a match: no button, no spinner.
 * - Settings gear in the top bar (slice S6a). With `analytics.upload.enabled` on, the first-run analytics notice
 *   (§5.4, D-8) sits under PLAY NOW until it is dismissed or Home is left by any action here. Otherwise, when Home
 *   gains focus and the D-17 conditions hold, the end-of-session export prompt card takes that place (slice S6c).
 * Modes that are not playable are not rendered (Q-11). The opponent chip comes with S4.
 */
export function HomeScreen(): JSX.Element {
  const { t } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  const router = useRouter();
  const enabled = useFlag('play_vs_bot.enabled');
  const session = useMatchSession();
  const [confirming, setConfirming] = useState(false);
  const analytics = usePlaytestAnalytics();
  const { noticeVisible } = useAnalyticsSnapshot();
  /** The end-of-session export prompt on display (matches this session), D-17; null when hidden. */
  const [prompt, setPrompt] = useState<number | null>(null);
  // Asked each time Home gains focus (e.g. back from a Summary); never while the first-run notice is up.
  useFocusEffect(
    useCallback(() => {
      if (analytics === null || noticeVisible || !analytics.exportPromptDue()) return;
      analytics.markExportPromptShown();
      setPrompt(analytics.sessionMatches());
    }, [analytics, noticeVisible]),
  );
  /** Leaving Home marks the notice seen (§5.4) and ends the prompt's display. */
  const leave = (): void => {
    analytics?.markNoticeSeen();
    setPrompt(null);
  };

  const live = session?.model ?? null;
  const saved = session?.saved ?? { kind: 'none' };
  const resumable: MatchModel | null =
    live?.state.status === 'in_progress' ? live : saved.kind === 'resumable' ? saved.model : null;
  const unusable =
    resumable === null && (saved.kind === 'version_mismatch' || saved.kind === 'state_corrupt')
      ? saved.kind
      : null;
  const bot = t('bot.beginner.name');

  const open = (): void => {
    leave();
    session?.play();
    router.push('/match');
  };
  const startNew = (): void => {
    leave();
    setConfirming(false);
    session?.startNew();
    router.push('/match');
  };

  const card = {
    borderRadius: radius.card,
    borderColor: color.borderSubtle,
    backgroundColor: color.bgSurface,
    padding: space[5],
    gap: space[4],
  };
  const paused = (
    <View testID="home.paused" accessible style={[styles.bordered, card]}>
      <Text style={[type.body, styles.centre, { color: color.textPrimary }]}>
        {t('home.paused')}
      </Text>
    </View>
  );

  let action: JSX.Element;
  if (resumable !== null) {
    const { state } = resumable;
    const status =
      state.seatOnTurn === HUMAN_SEAT
        ? t('home.resume.status.your_turn')
        : t('home.resume.status.bot_turn', { bot });
    action = (
      <View style={{ gap: space[3] }}>
        <View testID="home.resume" style={[styles.bordered, card]}>
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {t('home.resume', { bot })}
          </Text>
          <Text
            testID="home.resume.detail"
            style={[type.body, styles.mono, { color: color.textMuted }]}
          >
            {t('home.resume.detail', {
              bot,
              status,
              you: state.seats[HUMAN_SEAT]?.score ?? 0,
              them: state.seats[BOT_SEAT]?.score ?? 0,
            })}
          </Text>
          <Button
            testID="home.playNow"
            variant="primary"
            hero
            label={t('home.play_now')}
            accessibilityHint={t('home.resume', { bot })}
            onPress={open}
          />
        </View>
        {enabled && (
          <Button
            testID="home.newMatch"
            label={t('home.new_match')}
            onPress={() => {
              setConfirming(true);
            }}
          />
        )}
      </View>
    );
  } else if (unusable !== null) {
    action = (
      <View testID="home.cannotResume" style={[styles.bordered, card]}>
        <Text accessibilityLiveRegion="polite" style={[type.body, { color: color.textPrimary }]}>
          {t(unusable === 'version_mismatch' ? 'resume.version_mismatch' : 'resume.corrupt')}
        </Text>
        {enabled ? (
          <Button
            testID="home.startNew"
            variant="primary"
            label={t('resume.start_new')}
            onPress={startNew}
          />
        ) : (
          paused
        )}
      </View>
    );
  } else if (enabled) {
    action = (
      <Button
        testID="home.playNow"
        variant="primary"
        hero
        label={t('home.play_now')}
        disabled={saved.kind === 'checking'}
        onPress={open}
      />
    );
  } else {
    action = paused;
  }

  const openSettings = (): void => {
    leave();
    router.push('/settings');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View style={[styles.topBar, { paddingHorizontal: space[3] }]}>
        <Pressable
          testID="home.settings"
          accessibilityRole="button"
          accessibilityLabel={t('home.settings.a11y')}
          onPress={openSettings}
          style={[styles.icon, { minWidth: layout.touchMin, minHeight: layout.touchMin }]}
        >
          <Text style={[type.title, { color: color.textPrimary }]}>{GEAR_GLYPH}</Text>
        </Pressable>
      </View>
      <View style={[styles.brand, { padding: space[5], gap: space[3] }]}>
        <Text
          accessibilityRole="header"
          style={[type.display, styles.centre, { color: color.textPrimary }]}
        >
          {t('app.name')}
        </Text>
        <Text style={[type.bodyL, styles.centre, { color: color.textMuted }]}>
          {t('home.tagline')}
        </Text>
      </View>
      <View
        style={[
          styles.thumbZone,
          { paddingHorizontal: layout.marginScreen, paddingBottom: space[8], gap: space[4] },
        ]}
      >
        {action}
        {noticeVisible && <AnalyticsNotice onSettings={openSettings} onDismiss={leave} />}
        {!noticeVisible && prompt !== null && (
          <ExportPromptCard
            matches={prompt}
            onSend={() => {
              leave();
              router.push('/send-data');
            }}
            onLater={() => {
              setPrompt(null);
            }}
          />
        )}
      </View>
      <ConfirmSheet
        visible={confirming}
        testID="home.newMatch"
        destructive
        title={t('home.new_match.confirm.title')}
        body={t('home.new_match.confirm.body', { bot })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('home.new_match.confirm.action')}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={startNew}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { flex: 3, justifyContent: 'center' },
  centre: { textAlign: 'center' },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  thumbZone: { flex: 2, justifyContent: 'center', alignSelf: 'stretch' },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  bordered: { borderWidth: 1 },
});
