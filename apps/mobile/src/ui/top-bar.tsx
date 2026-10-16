import type { JSX } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n/i18n-provider';
import { useTokens } from '../theme/use-tokens';

/** Drawn left-pointing; mirrored when the layout is right-to-left. */
const BACK_GLYPH = '←';

/** E-1.5 §5.8/§5.9 top bar: a back button (48 dp, labelled `common.back`) and the screen title as a header. */
export function TopBar({
  title,
  onBack,
  testID,
}: {
  readonly title: string;
  readonly onBack: () => void;
  readonly testID: string;
}): JSX.Element {
  const { t } = useI18n();
  const { color, layout, space, type } = useTokens();
  return (
    <View style={[styles.bar, { paddingHorizontal: space[3], gap: space[2] }]}>
      <Pressable
        testID={`${testID}.back`}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onBack}
        style={[styles.centre, { minWidth: layout.touchMin, minHeight: layout.touchMin }]}
      >
        <Text
          style={[
            type.title,
            { color: color.textPrimary, transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] },
          ]}
        >
          {BACK_GLYPH}
        </Text>
      </Pressable>
      <Text
        accessibilityRole="header"
        style={[type.heading, styles.grow, { color: color.textPrimary }]}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexShrink: 1 },
});
