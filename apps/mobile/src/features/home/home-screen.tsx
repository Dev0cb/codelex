import { ENGINE_RULES_VERSION } from '@codelex/game-engine';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '../../i18n/i18n-provider';
import { useLexicon } from '../../lexicon/lexicon-gate';
import { useTokens } from '../../theme/use-tokens';

/**
 * Placeholder Home (sprint A1): proves the catalogs, the tokens, the workspace import of the rules engine and the
 * loaded, verified lexicon index (its `lexiconVersion`). The real Home (PLAY NOW, resume card) is slice S1 of E-1.5.
 */
export function HomeScreen(): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const { index } = useLexicon();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View style={[styles.content, { padding: space[5], gap: space[3] }]}>
        <Text accessibilityRole="header" style={[type.display, { color: color.textPrimary }]}>
          {t('app.name')}
        </Text>
        <Text style={[type.bodyL, { color: color.textPrimary }]}>{t('home.tagline')}</Text>
        <Text testID="engine-version" style={[type.caption, { color: color.textMuted }]}>
          {t('home.engine_version', { version: ENGINE_RULES_VERSION })}
        </Text>
        <Text testID="lexicon-version" style={[type.caption, { color: color.textMuted }]}>
          {t('home.lexicon_version', { version: index.version })}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, justifyContent: 'center' },
});
