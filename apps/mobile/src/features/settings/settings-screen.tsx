import { useRouter } from 'expo-router';
import { useState, type JSX, type ReactNode } from 'react';
import {
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalyticsSnapshot, usePlaytestAnalytics } from '../../analytics/analytics-provider';
import { useI18n } from '../../i18n/i18n-provider';
import { useSendMatchLog } from '../match-log/send-match-log';
import {
  MOTION_PREFERENCES,
  useMotionPreference,
  type MotionPreference,
} from '../../settings/motion-preference';
import { useTokens } from '../../theme/use-tokens';
import { TopBar } from '../../ui/top-bar';
import { ConfirmSheet } from '../match/match-sheets';

/** System mono (D-28): the tester ID. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** Row chevron, drawn right-pointing; mirrored when the layout is right-to-left. */
const CHEVRON_GLYPH = '›';

const MOTION_LABEL = {
  system: 'settings.motion.system',
  reduced: 'settings.motion.reduce',
  full: 'settings.motion.full',
} as const satisfies Record<MotionPreference, string>;

export interface BuildVersions {
  readonly app: string;
  readonly rules: number;
  readonly lexicon: string;
}

/**
 * Settings (E-1.5 design §5.8; slice S6a). Sections:
 * - **Playtest data**, only with `analytics.upload.enabled` on (spec "Flags & rollout" SP2): the consent toggle
 *   (AC-17, Q-7) and, while recording, the install-scoped tester ID as selectable text. Turning the toggle off asks
 *   first (`settings.analytics.off.*`, with the count of unsent events), then purges. While recording, "Send playtest data · N
 *   waiting ›" opens the export screen (§5.9, slice S6c). "Send match log ›" (slice S6d, AC-20) is behind its own
 *   flag `playtest.match_log.enabled`, not behind consent or `analytics.upload.enabled` (a user-initiated bug
 *   report): it opens the TM-05 confirm sheet, then the OS share sheet. The section shows when either flag is on.
 * - **Play**: Animations (Follow system / Reduced / Full, D-22). The other §5.8 Play rows (sound, vibration,
 *   auto-zoom, handedness) control features not built yet and are not rendered.
 * - **About this build**: `settings.about.versions` as plain text (the 7-tap Diagnostics entry is DG1's), and the
 *   language note.
 * No animation of its own; the confirm sheet fades under reduced motion (`Sheet`). Text scales to 200 %: rows wrap.
 */
export function SettingsScreen({ versions }: { readonly versions: BuildVersions }): JSX.Element {
  const { t } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  const router = useRouter();
  const analytics = usePlaytestAnalytics();
  const snapshot = useAnalyticsSnapshot();
  const motion = useMotionPreference();
  const matchLog = useSendMatchLog();
  /** The turn-off sheet: the unsent count and the tester ID to note before it is deleted (review M2). */
  const [confirmOff, setConfirmOff] = useState<{
    readonly count: number;
    readonly installId: string | null;
  } | null>(null);
  const [saveError, setSaveError] = useState(false);
  // Read at render: the snapshot changes (re-render) after every confirmed export (`exports`).
  const pending = t('settings.send_data.pending', { count: analytics?.queuedCount() ?? 0 });

  const save = (ok: boolean): void => {
    setSaveError(!ok);
  };
  const onToggle = (on: boolean): void => {
    if (analytics === null) return;
    if (on) save(analytics.setConsent(true));
    else setConfirmOff({ count: analytics.queuedCount(), installId: snapshot.installId });
  };

  const section = (title: string, testID: string, children: ReactNode): JSX.Element => (
    <View testID={testID} style={{ gap: space[3] }}>
      <Text
        accessibilityRole="header"
        style={[type.caption, styles.caps, { color: color.textMuted }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
  const row = { minHeight: 64, gap: space[2] };
  const chevron = (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        type.title,
        { color: color.textMuted, transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] },
      ]}
    >
      {CHEVRON_GLYPH}
    </Text>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <TopBar
        testID="settings"
        title={t('settings.title')}
        onBack={() => {
          router.back();
        }}
      />
      <ScrollView contentContainerStyle={{ padding: layout.marginScreen, gap: space[6] }}>
        {saveError && (
          <Text
            testID="settings.saveError"
            accessibilityLiveRegion="polite"
            style={[type.body, { color: color.feedbackError }]}
          >
            {t('settings.save_error')}
          </Text>
        )}
        {(snapshot.enabled || matchLog.available) &&
          section(
            t('settings.section.playtest'),
            'settings.playtest',
            <>
              {snapshot.enabled && (
                <View style={[styles.toggleRow, row]}>
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: color.textPrimary }]}>
                      {t('settings.analytics.toggle')}
                    </Text>
                    <Text style={[type.caption, { color: color.textMuted }]}>
                      {t('settings.analytics.desc')}
                    </Text>
                  </View>
                  <Switch
                    testID="settings.analytics.toggle"
                    accessibilityLabel={t('settings.analytics.toggle')}
                    value={snapshot.consent}
                    onValueChange={onToggle}
                    trackColor={{ false: color.borderSubtle, true: color.accentPrimary }}
                    thumbColor={color.bgRaised}
                  />
                </View>
              )}
              {snapshot.enabled && snapshot.consent && snapshot.installId !== null && (
                <View style={row}>
                  <Text style={[type.body, { color: color.textPrimary }]}>
                    {t('settings.install_id.label')}
                  </Text>
                  <Text
                    testID="settings.installId"
                    selectable
                    style={[type.body, styles.mono, { color: color.textPrimary }]}
                  >
                    {snapshot.installId}
                  </Text>
                  <Text style={[type.caption, { color: color.textMuted }]}>
                    {t('settings.install_id.help')}
                  </Text>
                </View>
              )}
              {snapshot.enabled && snapshot.consent && (
                <Pressable
                  testID="settings.sendData"
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.send_data')}, ${pending}`}
                  onPress={() => {
                    router.push('/send-data');
                  }}
                  style={[styles.toggleRow, row]}
                >
                  <Text style={[type.body, styles.grow, { color: color.textPrimary }]}>
                    {t('settings.send_data')}
                  </Text>
                  <Text
                    testID="settings.sendData.pending"
                    style={[type.caption, { color: color.textMuted }]}
                  >
                    {pending}
                  </Text>
                  {chevron}
                </Pressable>
              )}
              {matchLog.available && (
                <Pressable
                  testID="settings.sendMatchLog"
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.send_match_log')}, ${t('settings.send_match_log.desc')}`}
                  onPress={matchLog.open}
                  style={[styles.toggleRow, row]}
                >
                  <View style={styles.grow}>
                    <Text style={[type.body, { color: color.textPrimary }]}>
                      {t('settings.send_match_log')}
                    </Text>
                    <Text style={[type.caption, { color: color.textMuted }]}>
                      {t('settings.send_match_log.desc')}
                    </Text>
                  </View>
                  {chevron}
                </Pressable>
              )}
            </>,
          )}
        {section(
          t('settings.section.play'),
          'settings.play',
          <View style={row}>
            <Text style={[type.body, { color: color.textPrimary }]}>{t('settings.motion')}</Text>
            <View accessibilityRole="radiogroup" style={[styles.segments, { gap: space[2] }]}>
              {MOTION_PREFERENCES.map((value) => {
                const selected = motion.preference === value;
                return (
                  <Pressable
                    key={value}
                    testID={`settings.motion.${value}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      save(motion.setPreference(value));
                    }}
                    style={[
                      styles.centre,
                      {
                        minHeight: layout.touchMin,
                        minWidth: layout.touchMin,
                        paddingHorizontal: space[4],
                        borderRadius: radius.button,
                        borderWidth: 1,
                        borderColor: selected ? color.accentPrimary : color.borderSubtle,
                        backgroundColor: selected ? color.accentPrimary : color.bgRaised,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        type.body,
                        { color: selected ? color.accentOnPrimary : color.textPrimary },
                      ]}
                    >
                      {t(MOTION_LABEL[value])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>,
        )}
        {section(
          t('settings.section.about'),
          'settings.about',
          <View style={row}>
            <Text
              testID="settings.about.versions"
              style={[type.body, styles.mono, { color: color.textPrimary }]}
            >
              {t('settings.about.versions', { ...versions })}
            </Text>
            <Text style={[type.caption, { color: color.textMuted }]}>
              {t('settings.language.note')}
            </Text>
          </View>,
        )}
      </ScrollView>
      <ConfirmSheet
        visible={confirmOff !== null}
        testID="settings.analytics.off"
        destructive
        title={t('settings.analytics.off.title')}
        body={t('settings.analytics.off.body', { count: confirmOff?.count ?? 0 })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.analytics.off.confirm')}
        onCancel={() => {
          setConfirmOff(null);
        }}
        onConfirm={() => {
          setConfirmOff(null);
          if (analytics !== null) save(analytics.setConsent(false));
        }}
      >
        {confirmOff?.installId != null && (
          <View style={{ gap: space[2] }}>
            <Text style={[type.body, { color: color.textPrimary }]}>
              {t('settings.analytics.off.id_note')}
            </Text>
            <Text
              testID="settings.analytics.off.installId"
              selectable
              style={[type.body, styles.mono, { color: color.textPrimary }]}
            >
              {confirmOff.installId}
            </Text>
          </View>
        )}
      </ConfirmSheet>
      {matchLog.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  mono: { fontFamily: MONO },
  caps: { textTransform: 'uppercase' },
  segments: { flexDirection: 'row', flexWrap: 'wrap' },
});
