import { useEffect, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { MotionMode } from '../../a11y/accessibility';
import { useTokens } from '../../theme/use-tokens';

const DOTS = [0, 1, 2] as const;
const DOT = 6;

function PulsingDot({ index }: { readonly index: number }): JSX.Element {
  const { color, motion } = useTokens();
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    // A Reanimated animation runs on the UI thread, so it keeps pulsing while the bot computes on the JS thread
    // (P5 §4.2 rule 2). Under 3 Hz: one cycle is 2 × 320 ms.
    const step = motion.duration.slow;
    opacity.value = withDelay(
      index * motion.duration.fast,
      withRepeat(
        withSequence(withTiming(1, { duration: step }), withTiming(0.3, { duration: step })),
        -1,
      ),
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [index, motion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: color.textMuted }, style]} />;
}

/**
 * Bot "thinking" dots (E-1.5 D-25, §5.5.7; motion registry `bot.dots`): three pulsing dots, or three static dots
 * under reduced motion. Decorative: the status strip carries the words for screen readers.
 */
export function ThinkingIndicator({ motion }: { readonly motion: MotionMode }): JSX.Element {
  const { color, space } = useTokens();
  const reduced = motion === 'reduced';
  return (
    <View
      testID={reduced ? 'match.thinking.static' : 'match.thinking.animated'}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.row, { gap: space[2] }]}
    >
      {DOTS.map((index) =>
        reduced ? (
          <View key={index} style={[styles.dot, { backgroundColor: color.textMuted }]} />
        ) : (
          <PulsingDot key={index} index={index} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
