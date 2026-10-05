import { useRouter } from 'expo-router';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFlag } from '../../config/flags-provider';
import { useI18n } from '../../i18n/i18n-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

/**
 * Home (E-1.5 §5.2, slice S1): the name, the tagline and one dominant action, PLAY NOW, in the thumb zone. With
 * `play_vs_bot.enabled` off the button is replaced by an inert "paused" card (AC-19): no button, no spinner. Modes
 * that are not playable are not rendered (Q-11). Resume card, opponent chip and settings come with S3/S4/S6.
 */
export function HomeScreen(): JSX.Element {
  const { t } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  const router = useRouter();
  const enabled = useFlag('play_vs_bot.enabled');
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
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
          { paddingHorizontal: layout.marginScreen, paddingBottom: space[8] },
        ]}
      >
        {enabled ? (
          <Button
            testID="home.playNow"
            variant="primary"
            hero
            label={t('home.play_now')}
            onPress={() => {
              router.push('/match');
            }}
          />
        ) : (
          <View
            testID="home.paused"
            accessible
            style={[
              styles.paused,
              {
                borderRadius: radius.card,
                borderColor: color.borderSubtle,
                backgroundColor: color.bgSurface,
                padding: space[5],
              },
            ]}
          >
            <Text style={[type.body, styles.centre, { color: color.textPrimary }]}>
              {t('home.paused')}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { flex: 3, justifyContent: 'center' },
  centre: { textAlign: 'center' },
  thumbZone: { flex: 2, justifyContent: 'center', alignSelf: 'stretch' },
  paused: { borderWidth: 1 },
});
