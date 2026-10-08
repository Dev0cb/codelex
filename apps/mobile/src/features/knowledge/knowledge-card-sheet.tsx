import { CATEGORY_IDS, type CategoryTokenId, type HexColor } from '@codelex/design-system';
import { DIFFICULTIES } from '@codelex/lexicon/index';
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { useMotionMode } from '../../a11y/accessibility';
import { useI18n } from '../../i18n/i18n-provider';
import type { CategoryBadge, KnowledgeCard, RelatedTerm } from '../../knowledge/card-model';
import { DIFFICULTY_KEY } from '../../match/breakdown';
import { useTokens } from '../../theme/use-tokens';
import { categoryGlyph } from './category-glyph';
import { termChipLabel } from './chip-label';

/** System mono until a bundled mono face is decided (D-28). */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** Icon glyphs (not copy): close, back and the trailing chevron; arrows mirror in RTL. */
const CLOSE_GLYPH = '×';
const BACK_GLYPH = '←';
const CHEVRON_GLYPH = '›';
/** A downward swipe on the sheet header longer than this closes the sheet (E-1.4 §4 `BottomSheet`). */
export const SWIPE_CLOSE_DP = 64;
/** Gesture test id of the header swipe (jest `getByGestureTestId`). */
export const SWIPE_GESTURE_ID = 'card.swipe';
/** Related-term push: slide distance (full motion). */
const PUSH_OFFSET_DP = 24;

const isCategoryToken = (id: string): id is CategoryTokenId =>
  (CATEGORY_IDS as readonly string[]).includes(id);

/** The category hue, or the muted text colour for a category the tokens do not know yet. */
function useCategoryColor(category: CategoryBadge | null): HexColor {
  const tokens = useTokens();
  return category !== null && isCategoryToken(category.id)
    ? tokens.category[category.id]
    : tokens.color.textMuted;
}

function CategoryLabel({ category }: { readonly category: CategoryBadge | null }) {
  const { color, space, type } = useTokens();
  const hue = useCategoryColor(category);
  if (category === null) return null;
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      <Text
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={[type.bodyS, styles.glyph, { color: hue }]}
      >
        {categoryGlyph(category.icon)}
      </Text>
      <Text style={[type.bodyS, { color: color.textPrimary }]}>{category.name}</Text>
    </View>
  );
}

function RelatedChip({
  term,
  onPress,
}: {
  readonly term: RelatedTerm;
  readonly onPress: () => void;
}) {
  const { t, direction } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  const hue = useCategoryColor(term.category);
  return (
    <Pressable
      testID={`card.related.${term.termId}`}
      accessibilityRole="button"
      accessibilityLabel={termChipLabel(t, term, t('a11y.chip.state.known'))}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles.chip,
        {
          gap: space[2],
          minHeight: layout.touchMin,
          paddingHorizontal: space[4],
          borderRadius: radius.chip,
          borderColor: hue,
          backgroundColor: pressed ? color.bgSurface : color.bgRaised,
        },
      ]}
    >
      <Text style={[type.bodyS, styles.glyph, { color: hue }]}>
        {categoryGlyph(term.category?.icon)}
      </Text>
      <Text style={[type.body, { color: color.textPrimary }]}>{term.display}</Text>
      <Text style={[type.body, { color: color.textMuted }, mirrored(direction)]}>
        {CHEVRON_GLYPH}
      </Text>
    </Pressable>
  );
}

const mirrored = (direction: 'ltr' | 'rtl') =>
  direction === 'rtl' ? { transform: [{ scaleX: -1 }] } : undefined;

function Pips({ level }: { readonly level: number }) {
  const { color, space } = useTokens();
  return (
    <View
      style={[styles.row, { gap: space[1] }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {DIFFICULTIES.map((d, i) => (
        <View
          key={d}
          style={[
            styles.pip,
            {
              borderColor: color.textMuted,
              backgroundColor: i <= level ? color.textMuted : undefined,
            },
          ]}
        />
      ))}
    </View>
  );
}

function CardBody({
  card,
  onRelated,
}: {
  readonly card: KnowledgeCard;
  readonly onRelated: (term: RelatedTerm) => void;
}) {
  const { t, locale } = useI18n();
  const { color, radius, space, type } = useTokens();
  const titleRef = useRef<Text>(null);
  const level = DIFFICULTIES.indexOf(card.difficulty);
  // Focus moves to the new card's title on open and on every hop (§9.2: the sheet is a focus trap).
  useEffect(() => {
    const node = titleRef.current;
    if (node !== null) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, [card.termId]);
  return (
    <View style={{ gap: space[4] }}>
      <View style={[styles.row, styles.between, { gap: space[3] }]}>
        <CategoryLabel category={card.category} />
        <View
          accessible
          accessibilityLabel={t('card.difficulty.label', {
            level: t(DIFFICULTY_KEY[card.difficulty]),
          })}
          style={[styles.row, { gap: space[2] }]}
        >
          <Pips level={level} />
          <Text style={[type.bodyS, { color: color.textMuted }]}>
            {t(DIFFICULTY_KEY[card.difficulty])}
          </Text>
        </View>
      </View>
      <View style={{ gap: space[1] }}>
        <Text
          ref={titleRef}
          testID="card.title"
          accessibilityRole="header"
          accessibilityLabel={t('card.title.a11y', { term: card.display })}
          style={[type.title, styles.mono, { color: color.textPrimary }]}
        >
          {card.display}
        </Text>
        {card.playedAs !== null && (
          <Text testID="card.playedAs" style={[type.body, { color: color.textMuted }]}>
            {t('card.played_as', { form: card.playedAs })}
          </Text>
        )}
      </View>
      <View style={{ gap: space[2] }}>
        {card.definitionFallback && (
          <Text
            testID="card.fallbackTag"
            style={[
              type.caption,
              styles.tag,
              {
                color: color.textPrimary,
                borderColor: color.borderSubtle,
                borderRadius: radius.chip,
                paddingHorizontal: space[3],
                paddingVertical: space[1],
              },
            ]}
          >
            {t('card.definition.fallback_tag')}
          </Text>
        )}
        <Text
          testID="card.definition"
          accessibilityLanguage={card.definitionFallback ? 'en' : locale}
          style={[type.bodyL, { color: color.textPrimary }]}
        >
          {card.definition}
        </Text>
      </View>
      {/* §5.7 states: an empty related list hides the section (no "no related terms" copy). */}
      {card.related.length > 0 && (
        <View style={{ gap: space[2] }}>
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {t('card.related.title')}
          </Text>
          <View testID="card.related" style={[styles.wrap, { gap: space[2] }]}>
            {card.related.map((term) => (
              <RelatedChip
                key={term.termId}
                term={term}
                onPress={() => {
                  onRelated(term);
                }}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export interface KnowledgeCardSheetProps {
  /** The visible card; null = closed. */
  readonly card: KnowledgeCard | null;
  /** Open cards; the Back arrow shows from 2 (after a related-term hop). */
  readonly depth: number;
  readonly onRelated: (term: RelatedTerm) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

/**
 * The Knowledge Card (E-1.5 AC-13, design §5.7, D-16): a bottom sheet over the Summary, at most 85 % high, with a
 * grabber and an always-visible Close; Back appears after the first related-term hop. Close, the scrim, a downward
 * swipe on the header and system back on the first card all close it, so Play again is always one tap away.
 * Motion: slide 200 ms in, related cards slide in (reduced motion: 150 ms crossfades, §8.2).
 */
export function KnowledgeCardSheet({
  card,
  depth,
  onRelated,
  onBack,
  onClose,
}: KnowledgeCardSheetProps): JSX.Element {
  const { t, direction } = useI18n();
  const { color, layout, motion: motionTokens, overlay, radius, space, type } = useTokens();
  const motion = useMotionMode();
  const reduced = motion === 'reduced';

  // Each card (first open and every hop) fades or slides in.
  const [enter] = useState(() => new Animated.Value(1));
  const termId = card?.termId;
  useEffect(() => {
    if (termId === undefined) return;
    enter.setValue(0);
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? motionTokens.reducedCrossfade : motionTokens.duration.base,
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [termId, enter, reduced, motionTokens]);
  const slide = direction === 'rtl' ? -PUSH_OFFSET_DP : PUSH_OFFSET_DP;
  const translateX = reduced
    ? 0
    : enter.interpolate({ inputRange: [0, 1], outputRange: [depth > 1 ? slide : 0, 0] });

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .withTestId(SWIPE_GESTURE_ID)
    .activeOffsetY(12)
    .onEnd((event) => {
      if (event.translationY > SWIPE_CLOSE_DP) onClose();
    });

  const iconButton = {
    minWidth: layout.touchMin,
    minHeight: layout.touchMin,
  } as const;

  return (
    <Modal
      visible={card !== null}
      transparent
      animationType={reduced ? 'fade' : 'slide'}
      onRequestClose={depth > 1 ? onBack : onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <Pressable
          testID="card.scrim"
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: overlay.scrim, opacity: overlay.scrimOpacity },
          ]}
        />
        {card !== null && (
          <View
            testID="card.sheet"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: color.bgSurface,
                borderTopStartRadius: radius.sheet,
                borderTopEndRadius: radius.sheet,
                paddingHorizontal: space[5],
                paddingBottom: space[5],
              },
            ]}
          >
            <GestureDetector gesture={swipe}>
              <View testID="card.header" style={[styles.row, styles.between]}>
                <View style={iconButton}>
                  {depth > 1 && (
                    <Pressable
                      testID="card.back"
                      accessibilityRole="button"
                      accessibilityLabel={t('card.back.a11y')}
                      onPress={onBack}
                      style={[styles.centred, iconButton]}
                    >
                      <Text style={[type.title, { color: color.textPrimary }, mirrored(direction)]}>
                        {BACK_GLYPH}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <View
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                  style={[styles.grabber, { backgroundColor: color.borderSubtle }]}
                />
                <Pressable
                  testID="card.close"
                  accessibilityRole="button"
                  accessibilityLabel={t('card.close.a11y')}
                  onPress={onClose}
                  style={[styles.centred, iconButton]}
                >
                  <Text style={[type.title, { color: color.textPrimary }]}>{CLOSE_GLYPH}</Text>
                </Pressable>
              </View>
            </GestureDetector>
            <Animated.View style={[styles.body, { opacity: enter, transform: [{ translateX }] }]}>
              <ScrollView contentContainerStyle={{ paddingBottom: space[2] }}>
                <CardBody card={card} onRelated={onRelated} />
              </ScrollView>
            </Animated.View>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'stretch', maxHeight: '85%' },
  body: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  centred: { alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1 },
  tag: { alignSelf: 'flex-start', borderWidth: 1 },
  glyph: { fontWeight: '700' },
  mono: { fontFamily: MONO },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  pip: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
});
