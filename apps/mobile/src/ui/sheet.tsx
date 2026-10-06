import type { JSX, ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMotionMode } from '../a11y/accessibility';
import { useTokens } from '../theme/use-tokens';

export interface SheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly testID?: string;
  readonly children: ReactNode;
}

/**
 * E-1.4 §4 `BottomSheet`: bottom-anchored (thumb zone), scrim, a header for screen readers, content scrolls at 200 %
 * text. Slides in, or fades under reduced motion (§8.2). System back closes it.
 */
export function Sheet({ visible, title, onClose, testID, children }: SheetProps): JSX.Element {
  const { color, overlay, radius, space, type } = useTokens();
  const motion = useMotionMode();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={motion === 'reduced' ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: overlay.scrim, opacity: overlay.scrimOpacity },
          ]}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: color.bgSurface,
              borderTopStartRadius: radius.sheet,
              borderTopEndRadius: radius.sheet,
              padding: space[5],
            },
          ]}
        >
          <ScrollView contentContainerStyle={{ gap: space[4] }}>
            <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'stretch', maxHeight: '85%' },
});
