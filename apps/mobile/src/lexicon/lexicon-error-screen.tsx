import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '../i18n/i18n-provider';
import { useTokens } from '../theme/use-tokens';
import type { LexiconLoadErrorCode } from './load-lexicon';

export interface LexiconErrorScreenProps {
  readonly code: LexiconLoadErrorCode;
  /** Re-runs the load once (E-1.5 §5.10.1 "Try again"). */
  readonly onRetry: () => void;
}

/**
 * E-1.5 §5.10.1: full-screen "lexicon index missing or corrupt" state. Nothing of the app is mounted behind it.
 * TODO(S1): warning icon (64) and "Share diagnostics" (versions + code), which need the icon set and app version.
 */
export function LexiconErrorScreen({ code, onRetry }: LexiconErrorScreenProps): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View testID="lexicon-error" style={[styles.content, { padding: space[5], gap: space[3] }]}>
        <Text accessibilityRole="header" style={[type.title, { color: color.textPrimary }]}>
          {t('error.lexicon.title')}
        </Text>
        <Text style={[type.body, { color: color.textPrimary }]}>{t('error.lexicon.body')}</Text>
        <Text
          testID="lexicon-error-code"
          selectable
          style={[type.bodyS, { color: color.textMuted }]}
        >
          {t('error.lexicon.code', { code })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('error.lexicon.retry')}
          onPress={onRetry}
          style={[
            styles.button,
            { backgroundColor: color.accentPrimary, padding: space[4], marginTop: space[4] },
          ]}
        >
          <Text style={[type.heading, { color: color.accentOnPrimary }]}>
            {t('error.lexicon.retry')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, justifyContent: 'center' },
  button: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
