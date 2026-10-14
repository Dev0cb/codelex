import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../i18n/i18n-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

export interface AnalyticsNoticeProps {
  /** "Settings": opens Settings (Playtest data is its first section). */
  readonly onSettings: () => void;
  /** "Got it" or ✕. */
  readonly onDismiss: () => void;
}

/**
 * First-run analytics notice (E-1.5 §5.4, D-8): a card at the bottom of Home, never a modal, so PLAY NOW stays the
 * first focus and stays tappable (AC-1: no consent wall). Shown only with `analytics.upload.enabled` on, once.
 * No animation: it appears with the screen (nothing to reduce).
 */
export function AnalyticsNotice({ onSettings, onDismiss }: AnalyticsNoticeProps): JSX.Element {
  const { t } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  return (
    <View
      testID="home.notice"
      style={[
        styles.card,
        {
          borderRadius: radius.card,
          borderColor: color.borderSubtle,
          backgroundColor: color.bgSurface,
          padding: space[4],
          gap: space[3],
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Text
          accessibilityRole="header"
          style={[type.heading, styles.grow, { color: color.textPrimary }]}
        >
          {t('notice.analytics.title')}
        </Text>
        <Pressable
          testID="home.notice.close"
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onDismiss}
          style={[styles.icon, { minWidth: layout.touchMin, minHeight: layout.touchMin }]}
        >
          <Text style={[type.title, { color: color.textMuted }]}>{'×'}</Text>
        </Pressable>
      </View>
      <Text style={[type.body, { color: color.textPrimary }]}>{t('notice.analytics.body')}</Text>
      <View style={[styles.actions, { gap: space[3] }]}>
        <Button
          testID="home.notice.settings"
          label={t('notice.analytics.settings')}
          onPress={onSettings}
        />
        <Button testID="home.notice.ok" label={t('notice.analytics.ok')} onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
});
