import type { JSX } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTokens } from '../theme/use-tokens';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  /** E-1.4 §4 `Button`: primary (PLAY, PLAY NOW; `hero` = 72 dp) or secondary. */
  readonly variant?: 'primary' | 'secondary';
  readonly hero?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/**
 * Token-only button (E-1.4 §4): at least 48 × 48 dp, min width, multi-line labels (FR +30 %, 200 % text), never a
 * fixed width. Disabled stays focusable and says so to screen readers; reduced motion changes nothing here (the
 * pressed state is a colour change only).
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  hero = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps): JSX.Element {
  const { color, layout, radius, space, type } = useTokens();
  const primary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: hero ? 72 : layout.touchMin,
          minWidth: layout.touchMin,
          borderRadius: radius.button,
          paddingHorizontal: space[5],
          paddingVertical: space[3],
          backgroundColor: primary ? color.accentPrimary : color.bgRaised,
          borderColor: primary ? color.accentPrimary : color.borderSubtle,
          opacity: disabled ? 0.4 : 1,
        },
        pressed &&
          !disabled && { backgroundColor: primary ? color.accentPrimary : color.bgSurface },
      ]}
    >
      <Text
        style={[
          hero ? type.title : type.body,
          styles.label,
          { color: primary ? color.accentOnPrimary : color.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  label: { textAlign: 'center', fontWeight: '700' },
});
