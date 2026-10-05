import type { LetterTable } from '@codelex/game-engine';
import type { JSX } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../i18n/i18n-provider';
import type { RackSlot } from '../../match/match-model';
import { useTokens } from '../../theme/use-tokens';

/** D-30: the blank shows `_` on the rack (a code glyph, not copy). */
const BLANK_GLYPH = '_';
const CODE_A = 65;
/** System mono until JetBrains Mono is bundled (D-28). */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export interface RackViewProps {
  readonly slots: readonly RackSlot[];
  readonly selectedSlotId: number | null;
  readonly letters: LetterTable;
  readonly onSelect: (slotId: number) => void;
}

/**
 * The player's rack (E-1.4 §4 `RackTile`): 48 × 56 dp tiles, tap to select (raised + accent border, not colour
 * only), then tap a square. Never mirrored in RTL (A–Z is a game constant).
 */
export function RackView({ slots, selectedSlotId, letters, onSelect }: RackViewProps): JSX.Element {
  const { t } = useI18n();
  const { board, color, layout, radius, space } = useTokens();
  return (
    <View
      accessibilityLabel={t('a11y.rack.label')}
      style={[styles.rack, { gap: layout.rackGap, minHeight: layout.tileRackHeight + space[3] }]}
    >
      {slots.map((slot, index) => {
        const isBlank = slot.tile === '?';
        const value = isBlank ? 0 : (letters.values[slot.tile.charCodeAt(0) - CODE_A] ?? 0);
        const name = isBlank
          ? t('a11y.tile.blank_rack')
          : t('a11y.tile.letter', { letter: slot.tile, points: value });
        const selected = slot.id === selectedSlotId;
        return (
          <Pressable
            key={slot.id}
            testID={`match.rack.tile.${String(index)}`}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.rack.item', {
              index: index + 1,
              total: slots.length,
              tile: name,
            })}
            accessibilityHint={t('a11y.rack.hint')}
            accessibilityState={{ selected }}
            onPress={() => {
              onSelect(slot.id);
            }}
            style={[
              styles.tile,
              {
                width: layout.tileRackWidth,
                height: layout.tileRackHeight,
                borderRadius: radius.tile,
                backgroundColor: board.tileFace,
                borderColor: selected ? color.accentPrimary : board.tileBlankOutline,
                borderWidth: selected ? 3 : 1,
                borderStyle: isBlank ? 'dashed' : 'solid',
                transform: [{ translateY: selected ? -space[3] : 0 }],
              },
            ]}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={[styles.letter, { color: isBlank ? board.tileValue : board.tileInk }]}
            >
              {isBlank ? BLANK_GLYPH : slot.tile}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.value, { color: board.tileValue }]}>
              {value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rack: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    direction: 'ltr',
  },
  tile: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 24, fontWeight: '700', fontFamily: MONO },
  value: { position: 'absolute', end: 4, bottom: 2, fontSize: 11, fontWeight: '500' },
});
