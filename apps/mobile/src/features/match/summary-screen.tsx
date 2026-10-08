import { CATEGORY_IDS, type CategoryTokenId } from '@codelex/design-system';
import type { LetterTable } from '@codelex/game-engine';
import type { MessageKey } from '@codelex/i18n';
import { useCallback, useRef, useState, type JSX } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '../../i18n/i18n-provider';
import { knowledgeCard, type CardDeps } from '../../knowledge/card-model';
import type { CardTarget } from '../../knowledge/card-stack';
import { HUMAN_SEAT } from '../../match/play-config';
import type { MatchSummary, TermChip } from '../../match/summary';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { categoryGlyph } from '../knowledge/category-glyph';
import { KnowledgeCardSheet } from '../knowledge/knowledge-card-sheet';
import { useCardSheet } from '../knowledge/use-card-sheet';

type Outcome = MatchSummary['outcome'];

const TITLE: Readonly<Record<Outcome, MessageKey>> = {
  victory: 'summary.victory',
  defeat: 'summary.defeat',
  draw: 'summary.draw',
};
const SUBTITLE: Readonly<Record<Outcome, MessageKey>> = {
  victory: 'summary.sub.victory',
  defeat: 'summary.sub.defeat',
  draw: 'summary.sub.draw',
};

/** D-30: the blank shows `_` (a code glyph, not copy). */
const BLANK_GLYPH = '_';
const CODE_A = 65;
/** System mono until a bundled mono face is decided (D-28; the iOS asset budget has no room today). */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** A signed rack adjustment: symbols, not copy (U+2212 minus for negatives). */
const signed = (n: number): string => (n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '0');

export interface SummaryScreenProps {
  readonly summary: MatchSummary;
  readonly botName: string;
  readonly letters: LetterTable;
  /** False when `play_vs_bot.enabled` is off: Play again is replaced by the paused line (§5.6). */
  readonly canPlayAgain: boolean;
  readonly onPlayAgain: () => void;
  readonly onHome: () => void;
  /** Knowledge Card data; null when `knowledge_card.post_match.enabled` is off (AC-14) or the text is unusable. */
  readonly cards?: CardDeps | null;
  /** Clock of the card dwell time (tests). */
  readonly now?: () => number;
}

/** Trailing chevron of a tappable chip or row (an icon glyph, not copy); mirrored in RTL. */
const CHEVRON_GLYPH = '›';
const BEST_KEY = 'summary.bestWord';
const DISCOVER_KEY = 'summary.discover';

/** Remembers which control opened the card, so focus returns to it when the sheet closes (§9.2). */
type InvokerRefs = Map<string, View>;

function NewTag({ chip }: { readonly chip: TermChip }) {
  const { t } = useI18n();
  const { color, type } = useTokens();
  // D-15: the NEW tag is text, never colour alone.
  return chip.isNew ? (
    <Text
      testID={`summary.new.${chip.termId}`}
      style={[type.caption, { color: color.accentPrimary }]}
    >
      {t('summary.new_badge')}
    </Text>
  ) : null;
}

function Chips({
  chips,
  testID,
  cards,
  invokers,
  onOpen,
}: {
  readonly chips: readonly TermChip[];
  readonly testID: string;
  readonly cards: CardDeps | null;
  readonly invokers: InvokerRefs;
  readonly onOpen: (chip: TermChip, key: string) => void;
}) {
  const { t, direction } = useI18n();
  const tokens = useTokens();
  const { color, layout, radius, space, type } = tokens;
  const chipStyle = {
    gap: space[2],
    backgroundColor: color.bgRaised,
    borderColor: color.borderSubtle,
    borderRadius: radius.chip,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  };
  return (
    <View testID={testID} style={[styles.wrap, { gap: space[2] }]}>
      {chips.map((chip) => {
        const card = cards === null ? null : knowledgeCard(cards, chip.termId, chip.form);
        if (card === null) {
          // AC-14 (flag off) and AC-13 (no definition): inert, no chevron, no ripple, not a button.
          return (
            <View key={chip.termId} style={[styles.row, chipStyle, styles.chip]}>
              <Text style={[type.bodyS, styles.mono, { color: color.textPrimary }]}>
                {chip.form}
              </Text>
              <NewTag chip={chip} />
            </View>
          );
        }
        const key = `${testID}.${chip.termId}`;
        const hue = isCategoryToken(card.category?.id) ? tokens.category[card.category.id] : null;
        return (
          <Pressable
            key={chip.termId}
            testID={`summary.term.${chip.termId}`}
            ref={(node) => {
              if (node === null) invokers.delete(key);
              else invokers.set(key, node);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.chip.term', {
              term: card.display,
              category: card.category?.name ?? '',
              state: t(chip.isNew ? 'a11y.chip.state.new' : 'a11y.chip.state.known'),
            })}
            onPress={() => {
              onOpen(chip, key);
            }}
            style={({ pressed }) => [
              styles.row,
              chipStyle,
              styles.chip,
              { minHeight: layout.touchMin },
              pressed && { backgroundColor: color.bgSurface },
            ]}
          >
            <Text style={[type.bodyS, styles.glyph, { color: hue ?? color.textMuted }]}>
              {categoryGlyph(card.category?.icon)}
            </Text>
            <Text style={[type.body, { color: color.textPrimary }]}>{card.display}</Text>
            <NewTag chip={chip} />
            <Text
              style={[type.body, { color: color.textMuted }, direction === 'rtl' && styles.flip]}
            >
              {CHEVRON_GLYPH}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const isCategoryToken = (id: string | undefined): id is CategoryTokenId =>
  id !== undefined && (CATEGORY_IDS as readonly string[]).includes(id);

/**
 * The end-of-match Summary (E-1.5 AC-10, design §5.6, D-15): result, final scores with rack adjustments, why it
 * ended, the margin, the best word, the terms both sides played (deduplicated, canonical) and the bot's last rack,
 * with a sticky action bar so Play again is one tap from anywhere. Numbers are the engine's (see `summarize`).
 * Tone: celebratory on a win, never mocking on a loss (§8.1).
 *
 * Knowledge Cards (slice S5, AC-13/AC-14): with `cards` (flag on), chips whose term has a definition, the best word
 * and "Discover the terms you played" open the card sheet on tap; nothing opens on its own. Without `cards` the chips
 * stay inert and no entry point is shown.
 */
export function SummaryScreen({
  summary,
  botName,
  letters,
  canPlayAgain,
  onPlayAgain,
  onHome,
  cards = null,
  now,
}: SummaryScreenProps): JSX.Element {
  const { t, direction } = useI18n();
  const { board, color, layout, radius, space, type } = useTokens();
  const result = t(TITLE[summary.outcome]);
  const best = summary.bestWord;
  const noTerms = summary.terms.you.length === 0 && summary.terms.bot.length === 0;

  const sheet = useCardSheet(cards, now);
  const [invokers] = useState<InvokerRefs>(() => new Map());
  const invoker = useRef<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const openCard = useCallback(
    (target: CardTarget, key: string) => {
      invoker.current = key;
      setOpenFailed(!sheet.open(target));
    },
    [sheet],
  );
  const openChip = useCallback(
    (chip: TermChip, key: string) => {
      openCard({ termId: chip.termId, form: chip.form, playedAs: chip.playedAs }, key);
    },
    [openCard],
  );
  // §9.2: closing the sheet returns focus to the control that opened it.
  const closeSheet = useCallback(() => {
    sheet.close();
    const node = invoker.current === null ? undefined : invokers.get(invoker.current);
    if (node !== undefined) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, [sheet, invokers]);
  const back = useCallback(() => {
    if (sheet.depth > 1) sheet.back();
    else closeSheet();
  }, [sheet, closeSheet]);

  const bestCard =
    cards === null || best === null
      ? null
      : knowledgeCard(cards, best.termId, best.canonicalForm, best.form);
  // §5.6: Discover opens the first tappable chip of the player's group (else the bot's); hidden when none is.
  const discover =
    cards === null
      ? undefined
      : [...summary.terms.you, ...summary.terms.bot].find(
          (chip) => knowledgeCard(cards, chip.termId, chip.form) !== null,
        );
  const bestText =
    best === null
      ? t('summary.best_word.none')
      : t('summary.best_word.detail', {
          form: best.form,
          points: best.points,
          actor: best.seat === HUMAN_SEAT ? t('match.you') : botName,
        });
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={t('a11y.announce.result', {
            result,
            you: summary.you,
            them: summary.them,
          })}
          style={[styles.centre, { gap: space[2] }]}
        >
          <Text testID="summary.result" style={[type.display, { color: color.textPrimary }]}>
            {result}
          </Text>
          <Text style={[type.bodyL, { color: color.textMuted }]}>
            {t(SUBTITLE[summary.outcome])}
          </Text>
        </View>
        <View style={[styles.scores, { gap: space[6] }]}>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{t('match.you')}</Text>
            <Text
              testID="summary.score.you"
              style={[type.title, styles.mono, { color: color.textPrimary }]}
            >
              {summary.you}
            </Text>
          </View>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{botName}</Text>
            <Text
              testID="summary.score.bot"
              style={[type.title, styles.mono, { color: color.textPrimary }]}
            >
              {summary.them}
            </Text>
          </View>
        </View>
        <View style={[styles.centre, { gap: space[1] }]}>
          {summary.adjustments !== null && (
            <Text testID="summary.rackAdjust" style={[type.body, { color: color.textMuted }]}>
              {t('summary.rack_adjust', {
                bot: botName,
                you: signed(summary.adjustments.you),
                them: signed(summary.adjustments.them),
              })}
            </Text>
          )}
          {summary.end !== null && (
            <Text testID="summary.reason" style={[type.body, { color: color.textMuted }]}>
              {t(summary.end.key, { ...summary.end.params, bot: botName })}
            </Text>
          )}
          <Text testID="summary.margin" style={[type.bodyS, { color: color.textMuted }]}>
            {t('summary.margin', { margin: summary.margin })}
          </Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {t('summary.best_word')}
          </Text>
          {best === null || bestCard === null ? (
            <Text testID="summary.bestWord" style={[type.body, { color: color.textPrimary }]}>
              {bestText}
            </Text>
          ) : (
            <Pressable
              testID="summary.bestWord.open"
              ref={(node) => {
                if (node === null) invokers.delete(BEST_KEY);
                else invokers.set(BEST_KEY, node);
              }}
              accessibilityRole="button"
              accessibilityHint={t('a11y.chip.state.known')}
              onPress={() => {
                openCard(
                  { termId: best.termId, form: best.canonicalForm, playedAs: best.form },
                  BEST_KEY,
                );
              }}
              style={({ pressed }) => [
                styles.row,
                styles.between,
                styles.chip,
                {
                  gap: space[2],
                  minHeight: layout.touchMin,
                  paddingHorizontal: space[4],
                  borderRadius: radius.card,
                  borderColor: color.borderSubtle,
                  backgroundColor: pressed ? color.bgSurface : color.bgRaised,
                },
              ]}
            >
              <Text testID="summary.bestWord" style={[type.body, { color: color.textPrimary }]}>
                {bestText}
              </Text>
              <Text
                style={[type.body, { color: color.textMuted }, direction === 'rtl' && styles.flip]}
              >
                {CHEVRON_GLYPH}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ gap: space[2] }}>
          <View style={[styles.row, styles.between, { gap: space[2] }]}>
            <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
              {t('summary.terms.title')}
            </Text>
            {/* §5.6: hidden with no terms, and without an on-device history. */}
            {!noTerms && summary.newToYou !== null && summary.newToYou > 0 && (
              <Text testID="summary.newToYou" style={[type.bodyS, { color: color.textMuted }]}>
                {t('summary.new_to_you', { count: summary.newToYou })}
              </Text>
            )}
          </View>
          {noTerms ? (
            <Text style={[type.body, { color: color.textMuted }]}>{t('summary.terms.empty')}</Text>
          ) : (
            <>
              <Text style={[type.caption, { color: color.textMuted }]}>
                {t('summary.terms.you')}
              </Text>
              <Chips
                chips={summary.terms.you}
                testID="summary.terms.you"
                cards={cards}
                invokers={invokers}
                onOpen={openChip}
              />
              <Text style={[type.caption, { color: color.textMuted }]}>{botName}</Text>
              <Chips
                chips={summary.terms.bot}
                testID="summary.terms.bot"
                cards={cards}
                invokers={invokers}
                onOpen={openChip}
              />
              {discover !== undefined && (
                <View
                  ref={(node) => {
                    if (node === null) invokers.delete(DISCOVER_KEY);
                    else invokers.set(DISCOVER_KEY, node);
                  }}
                >
                  <Button
                    testID="summary.discover"
                    label={t('summary.discover')}
                    onPress={() => {
                      openChip(discover, DISCOVER_KEY);
                    }}
                  />
                </View>
              )}
            </>
          )}
        </View>

        {summary.botRack !== null && (
          <View style={{ gap: space[2] }}>
            <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
              {t('summary.bot_rack', { bot: botName })}
            </Text>
            {summary.botRack === '' ? (
              <Text style={[type.body, { color: color.textMuted }]}>
                {t('summary.bot_rack.empty')}
              </Text>
            ) : (
              <View testID="summary.botRack" style={[styles.wrap, { gap: layout.rackGap }]}>
                {Array.from(summary.botRack, (tile) => tile).map((tile, i) => {
                  const isBlank = tile === '?';
                  const value = isBlank ? 0 : (letters.values[tile.charCodeAt(0) - CODE_A] ?? 0);
                  return (
                    <View
                      key={i}
                      accessible
                      accessibilityLabel={
                        isBlank
                          ? t('a11y.tile.blank_rack')
                          : t('a11y.tile.letter', { letter: tile, points: value })
                      }
                      style={[
                        styles.tile,
                        {
                          width: layout.touchMin * 0.75,
                          height: layout.touchMin * 0.75,
                          borderRadius: radius.tile,
                          backgroundColor: board.tileFace,
                        },
                      ]}
                    >
                      <Text style={[type.title, styles.mono, { color: board.tileInk }]}>
                        {isBlank ? BLANK_GLYPH : tile}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      {/* D-15: sticky bar, exempt from scrolling, so Play again is one tap away from anywhere. */}
      <View
        style={[
          styles.bar,
          { padding: space[5], gap: space[3], borderTopColor: color.borderSubtle },
        ]}
      >
        {/* §5.7 error state: no sheet, a message; the Summary is unaffected. */}
        {openFailed && (
          <Text
            testID="summary.cardError"
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={[type.body, styles.centre, { color: color.feedbackError }]}
          >
            {t('card.error.open')}
          </Text>
        )}
        {canPlayAgain ? (
          <Button
            testID="summary.playAgain"
            variant="primary"
            label={t('summary.play_again')}
            onPress={onPlayAgain}
          />
        ) : (
          <Text style={[type.body, styles.centre, { color: color.textMuted }]}>
            {t('home.paused')}
          </Text>
        )}
        <Button testID="summary.home" label={t('summary.home')} onPress={onHome} />
      </View>
      {cards !== null && (
        <KnowledgeCardSheet
          card={sheet.card}
          depth={sheet.depth}
          onRelated={(term) => {
            sheet.openRelated(
              { termId: term.termId, form: term.form, playedAs: null },
              term.relation,
            );
          }}
          onBack={back}
          onClose={closeSheet}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', textAlign: 'center' },
  scores: { flexDirection: 'row', justifyContent: 'center' },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' },
  chip: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  bar: { alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth },
  glyph: { fontWeight: '700' },
  flip: { transform: [{ scaleX: -1 }] },
});
