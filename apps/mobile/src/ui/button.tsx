import type { JSX, Ref } from 'react';
import { Pressable, StyleSheet, Text, type View } from 'react-native';

import { useTokens } from '../theme/use-tokens';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  /** E-1.4 §4 `Button`: primary (PLAY, PLAY NOW; `hero` = 72 dp), secondary or destructive (Resign). */
  readonly variant?: 'primary' | 'secondary' | 'destructive';
  readonly hero?: boolean;
  readonly disabled?: boolean;
  /**
   * Looks disabled but stays pressable, so a tap can explain why the action is unavailable (E-1.5 §5.5.6: the
   * "why" is never hidden). Screen readers hear the `accessibilityHint`.
   */
  readonly unavailable?: boolean;
  /** Work started by this button is in progress (screen readers announce it busy), e.g. an open share sheet. */
  readonly busy?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string | undefined;
  readonly testID?: string;
  /** The pressable host view (e.g. to return accessibility focus to it). */
  readonly ref?: Ref<View>;
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
  unavailable = false,
  busy,
  accessibilityLabel,
  accessibilityHint,
  testID,
  ref,
}: ButtonProps): JSX.Element {
  const { color, layout, radius, space, type } = useTokens();
  const primary = variant === 'primary';
  // Destructive = the error colour as text and border on the raised surface (a CONTRAST_PAIRS text pair).
  const destructive = variant === 'destructive';
  const fill = primary ? color.accentPrimary : color.bgRaised;
  const ink = primary
    ? color.accentOnPrimary
    : destructive
      ? color.feedbackError
      : color.textPrimary;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
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
          backgroundColor: fill,
          borderColor: primary ? fill : destructive ? color.feedbackError : color.borderSubtle,
          opacity: disabled || unavailable ? 0.4 : 1,
        },
        pressed && !disabled && !primary && { backgroundColor: color.bgSurface },
      ]}
    >
      <Text style={[hero ? type.title : type.body, styles.label, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  label: { textAlign: 'center', fontWeight: '700' },
});
